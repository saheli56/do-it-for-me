import type { AgentAction } from "@difm/shared";

export function extractCleanSearchQuery(goal: string): string {
  // 1. If user put quotes around product name like 'Logitech MX Master 3S wireless mouse'
  const quotedMatch = goal.match(/['"“‘]([^'"”’]{3,60})['"”’]/);
  if (quotedMatch && quotedMatch[1]) {
    let clean = quotedMatch[1].trim();
    clean = clean.replace(/^(a|an|the)\s+/i, "");
    return clean;
  }

  // 2. Strip leading prompt phrases
  let q = goal
    .replace(/^(please\s+)?(search\s+for|search|find|look\s+for|buy|purchase|add\s+to\s+cart|order|get)\s+(a|an|the)?\s*/i, "")
    .trim();

  // 3. Strip trailing intent instructions and conditional price triggers
  q = q.replace(/(?:when|if)\s+(?:the\s+|it's\s+|its\s+)?price.*$/i, "");
  q = q.replace(/,\s*(find|select|choose|check|with|in|and\s+add|add).*/i, "");
  q = q.replace(/\s+(and\s+)?((?:add\s+)?(?:this\s+product\s+|it\s+)?(?:in|to)\s*(?:my\s+)?(?:cart|bag)|buy\s+(?:it|this)|purchase\s+(?:it|this)).*/i, "");
  q = q.replace(/\s+(from|on|in)\s+(amazon(\.in|\.com)?|flipkart(\.com)?|myntra(\.com)?|meesho(\.com)?).*/i, "");
  q = q.replace(/\s+(if\s+available|option\s+if\s+available).*/i, "");
  q = q.replace(/^(a|an|the)\s+/i, "");

  return q.trim() || goal;
}

export function evaluateHeuristics(
  goal: string,
  observation: any,
  context?: { alreadyAddedToCart?: boolean }
): AgentAction | null {
  const goalLower = goal.toLowerCase();

  // Strictly enforce Quantity = 1: if item was already added to cart in this run, NEVER click Add to Cart again!
  const wantsCartAction = /add.*(cart|bag)|buy|purchase/i.test(goalLower);
  if (context?.alreadyAddedToCart && wantsCartAction) {
    return {
      type: "COMPLETE",
      summary: "Product successfully added to cart (Quantity: 1)."
    };
  }
  
  let urlObj: URL;
  try {
    urlObj = new URL(observation.url || "about:blank");
  } catch {
    urlObj = new URL("about:blank");
  }

  const hostname = urlObj.hostname.toLowerCase();
  const pathname = urlObj.pathname.toLowerCase();
  const urlLower = (observation.url || "").toLowerCase();

  const isAmazon = hostname.includes("amazon.in") || hostname.includes("amazon.com");
  const isFlipkart = hostname.includes("flipkart.com");
  const isMyntra = hostname.includes("myntra.com");
  const isMeesho = hostname.includes("meesho.com");
  const isShoppingPlatform = isAmazon || isFlipkart || isMyntra || isMeesho;

  const isHomepage = pathname === "/" || pathname === "" || pathname === "/index.html";
  const nodes: any[] = observation.interactiveNodes || [];

  // =========================================================================
  // 1. FINANCIAL PAYMENT GATEWAY & AUTHORIZATION SAFETY (HIGHEST PRIORITY)
  // =========================================================================
  // DIFM policy: Perform all prep/checkout/form tasks up to the payment screen,
  // but NEVER execute final payment/charging automatically.
  const isPaymentUrl =
    pathname.includes("/payment") ||
    pathname.includes("/checkout/payment") ||
    pathname.includes("/pay") ||
    pathname.includes("/gateway") ||
    pathname.includes("/razorpay") ||
    pathname.includes("/billpay");

  const paymentConfirmBtn = nodes.find(n => {
    const name = (n.name || "").toLowerCase().trim();
    return (
      name.startsWith("pay ₹") ||
      name.startsWith("pay rs") ||
      name === "pay now" ||
      name === "complete payment" ||
      name === "authorize payment" ||
      name === "make payment" ||
      name === "confirm and pay" ||
      name === "proceed to pay" ||
      name === "place order" ||
      name === "confirm payment"
    );
  });

  if (isPaymentUrl || (paymentConfirmBtn && (urlLower.includes("checkout") || urlLower.includes("cart") || urlLower.includes("order") || isPaymentUrl))) {
    // If user's goal was to make a payment or buy, we halt at the authorization screen
    return {
      type: "REQUEST_APPROVAL",
      summary: `Payment screen reached on ${hostname || "portal"}. All form details and checkout preparation are complete.`,
      details: { url: observation.url, title: observation.title, actionRequired: "Manual payment authorization" },
      consequences: "DIFM strictly restricts autonomous financial payments for your security. Please review order amount and authorize payment manually."
    };
  }

  // =========================================================================
  // 2. ORDER CANCELLATION & CART ITEM REMOVAL HEURISTICS
  // =========================================================================
  const isCancelOrderIntent =
    /canc(el|le).*(order|item|product|booking|subscription)?/i.test(goalLower) ||
    goalLower.includes("cancel") ||
    goalLower.includes("cancle") ||
    goalLower.includes("cancellation");

  const isRemoveFromCartIntent =
    /remove.*(cart|bag|item|product)/i.test(goalLower) ||
    /delete.*(cart|bag|item|product)/i.test(goalLower) ||
    /clear.*(cart|bag)/i.test(goalLower) ||
    /empty.*(cart|bag)/i.test(goalLower) ||
    goalLower.includes("remove from") ||
    goalLower.includes("delete from");

  // 2a. On Cart / Bag page: Remove Item
  const isCartPage =
    pathname.includes("/cart") ||
    pathname.includes("/bag") ||
    pathname.includes("/viewcart") ||
    pathname.includes("/gp/cart");

  if (isCartPage && (isRemoveFromCartIntent || (isCancelOrderIntent && goalLower.includes("cart")))) {
    // Check if cart is already empty
    const emptyCartMsg = nodes.find(n => {
      const name = (n.name || "").toLowerCase();
      return name.includes("cart is empty") || name.includes("bag is empty") || name.includes("no items in cart");
    });
    if (emptyCartMsg) {
      return {
        type: "COMPLETE",
        summary: "Cart is currently empty. Item removal completed."
      };
    }

    // Look for Remove / Delete button
    const removeBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      return (
        name === "remove" ||
        name === "delete" ||
        name.includes("remove from") ||
        name.includes("delete item") ||
        name.includes("delete from") ||
        name === "remove item"
      );
    });

    if (removeBtn) {
      return {
        type: "CLICK",
        target: { id: removeBtn.id, name: removeBtn.name },
        description: `Clicked "${removeBtn.name}" to remove product from cart`
      };
    }

    // Look for confirmation modal button (e.g. "Yes, Remove" or "Remove")
    const confirmRemoveBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      return name === "yes" || name === "confirm" || name === "yes, remove";
    });
    if (confirmRemoveBtn) {
      return {
        type: "CLICK",
        target: { id: confirmRemoveBtn.id, name: confirmRemoveBtn.name },
        description: `Confirmed item removal from cart`
      };
    }
  }

  // 2b. On Orders page: Cancel Order
  const isOrdersPage =
    pathname.includes("/order") ||
    pathname.includes("/orders") ||
    pathname.includes("/your-orders") ||
    pathname.includes("/my-orders");

  if (isOrdersPage && isCancelOrderIntent) {
    const cancelOrderBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      return (
        name.includes("cancel order") ||
        name.includes("cancel item") ||
        name.includes("request cancellation") ||
        name === "cancel items"
      );
    });

    if (cancelOrderBtn) {
      return {
        type: "CLICK",
        target: { id: cancelOrderBtn.id, name: cancelOrderBtn.name },
        description: `Clicked "${cancelOrderBtn.name}" to initiate order cancellation`
      };
    }

    // Check for cancellation reason / submit confirmation
    const confirmCancelBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      return (
        name.includes("confirm cancellation") ||
        name.includes("cancel order") ||
        name === "submit request"
      );
    });
    if (confirmCancelBtn) {
      return {
        type: "CLICK",
        target: { id: confirmCancelBtn.id, name: confirmCancelBtn.name },
        description: `Clicked "${confirmCancelBtn.name}" to finalize order cancellation`
      };
    }
  }

  // 2c. Navigation to Cart or Orders if currently on shopping site homepage/pages
  if (isShoppingPlatform) {
    if (isRemoveFromCartIntent && !isCartPage) {
      const cartLink = nodes.find(n => {
        const name = (n.name || "").toLowerCase().trim();
        return name === "cart" || name === "bag" || name.includes("view cart") || name.includes("go to cart");
      });
      if (cartLink) {
        return {
          type: "CLICK",
          target: { id: cartLink.id, name: cartLink.name },
          description: `Navigating to cart to remove item`
        };
      }
    }

    if (isCancelOrderIntent && !isOrdersPage) {
      const ordersLink = nodes.find(n => {
        const name = (n.name || "").toLowerCase().trim();
        return (
          name.includes("my orders") ||
          name.includes("your orders") ||
          name.includes("returns & orders") ||
          name === "orders"
        );
      });
      if (ordersLink) {
        return {
          type: "CLICK",
          target: { id: ordersLink.id, name: ordersLink.name },
          description: `Navigating to orders to cancel item`
        };
      }
    }
  }

  // =========================================================================
  // 3. STORE HOMEPAGE -> SEARCH INPUT
  // =========================================================================
  const isShoppingHomepage = isHomepage && isShoppingPlatform;
  const isShoppingSearchIntent = ["compare", "buy", "watch", "search", "purchase", "cart", "bag", "find"].some(w => goalLower.includes(w));

  if (isShoppingHomepage && isShoppingSearchIntent) {
    const searchBox = nodes.find(n => 
      n.role === "textbox" || n.role === "combobox" || n.role === "search" || 
      (n.name && n.name.toLowerCase().includes("search")) ||
      (n.placeholder && n.placeholder.toLowerCase().includes("search")) ||
      (n.placeholder && (n.placeholder.toLowerCase().includes("try") || n.placeholder.toLowerCase().includes("find")))
    );

    if (searchBox) {
      const cleanQuery = extractCleanSearchQuery(goal);
      return {
        type: "TYPE",
        target: { id: searchBox.id, name: searchBox.name },
        text: cleanQuery,
        description: `Typed "${cleanQuery}" into search box via fast heuristics`
      };
    }
  }

  // =========================================================================
  // 4. SEARCH RESULTS PAGE -> CLICK BEST MATCHING PRODUCT
  // =========================================================================
  const isAmazonSearchResults = isAmazon && (urlLower.includes("s?k=") || urlLower.includes("/s?"));
  const isFlipkartSearchResults = isFlipkart && (urlLower.includes("search?q=") || urlLower.includes("/search"));
  const isMyntraSearchResults = isMyntra && (urlLower.includes("/search") || urlLower.includes("?rawquery=") || urlLower.includes("?q="));
  const isMeeshoSearchResults = isMeesho && (urlLower.includes("search?q=") || urlLower.includes("/search"));

  if (isAmazonSearchResults || isFlipkartSearchResults || isMyntraSearchResults || isMeeshoSearchResults) {
    let queryWords: string[] = [];
    try {
      const qParam = isAmazon
        ? urlObj.searchParams.get("k")
        : (urlObj.searchParams.get("q") || urlObj.searchParams.get("rawQuery"));
      if (qParam) {
        queryWords = qParam.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      }
    } catch {}

    if (queryWords.length === 0) {
      const extracted = extractCleanSearchQuery(goal);
      queryWords = extracted.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    }

    const validLinks = nodes.filter(n => {
      const href = (n.href || "").toLowerCase();
      const isProductLink =
        n.role === "link" ||
        href.includes("/p/") ||
        href.includes("/dp/") ||
        href.includes("/buy") ||
        (isMeesho && href.includes("/p/"));
      if (!isProductLink) return false;

      const name = (n.name || "").toLowerCase();
      if (!name || name.length < 10) return false;
      if (name.includes("customer review") || name.includes("explore plus") || name.includes("sponsored")) return false;

      // Negative keywords: accessories when target is a hardware device
      if (
        name.includes("case") ||
        name.includes("cover") ||
        name.includes("protector") ||
        name.includes("guard") ||
        name.includes("sleeve") ||
        name.includes("skin")
      ) {
        return false;
      }
      return true;
    });

    // Score and rank links by keyword matching and model disambiguation
    const scoredLinks = validLinks.map(link => {
      const nameLower = (link.name || "").toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 2;
      }

      // Model Disambiguation rules
      if (goalLower.includes("master") && nameLower.includes("master")) score += 10;
      if (goalLower.includes("master") && nameLower.includes("anywhere")) score -= 15; // reject Anywhere if Master requested
      if (goalLower.includes("anywhere") && nameLower.includes("anywhere")) score += 10;
      if (goalLower.includes("anywhere") && nameLower.includes("master")) score -= 15;
      
      if (goalLower.includes("3s") && nameLower.includes("3s")) score += 6;
      if (goalLower.includes("3s") && !nameLower.includes("3s") && (nameLower.includes("2s") || nameLower.includes("3"))) score -= 5;

      if (goalLower.includes("black") && (nameLower.includes("black") || nameLower.includes("graphite") || nameLower.includes("dark"))) score += 3;
      if (goalLower.includes("white") && (nameLower.includes("white") || nameLower.includes("pale grey") || nameLower.includes("silver"))) score += 3;

      return { link, score };
    });

    scoredLinks.sort((a, b) => b.score - a.score);

    // Price condition check: e.g. "if price is less than 70000", "under 70000"
    const priceConditionMatch =
      goal.match(/(?:when|if)\s+(?:the\s+|it's\s+|its\s+)?price\s+(?:drops\s+below|is\s+below|is\s+under|is\s+less\s+than|less\s+than|under|below|falls\s+below|<=|<)\s*([₹$€£]?\s*[\d,]+(?:\.\d+)?)/i) ||
      goal.match(/(?:under|below|less\s+than|<=|<)\s*([₹$€£]?\s*[\d,]+(?:\.\d+)?)/i);
    let maxAllowedPrice: number | undefined = undefined;
    if (priceConditionMatch) {
      maxAllowedPrice = parseFloat(priceConditionMatch[1].replace(/[^\d.]/g, ""));
    }

    if (scoredLinks.length > 0 && scoredLinks[0].score > 0) {
      const best = scoredLinks[0].link;

      // Check if price from productContext is known for this matched link
      if (maxAllowedPrice && observation.productContext?.searchResults) {
        const matchedCard = observation.productContext.searchResults.find(
          (sr: any) => sr.nodeId === best.id || (sr.title && best.name && sr.title.toLowerCase().includes(best.name.toLowerCase().slice(0, 20)))
        );
        if (matchedCard && matchedCard.priceNumber) {
          if (matchedCard.priceNumber > maxAllowedPrice) {
            return {
              type: "COMPLETE",
              summary: `Found "${matchedCard.title}" at ₹${matchedCard.priceNumber}, which exceeds the requested price limit of ₹${maxAllowedPrice}. Product not added to cart.`
            };
          }
        }
      }

      // If user wants to add to cart and there is a direct Add to Cart button on search cards
      const wantsCart = /add.*(cart|bag)|buy|purchase/i.test(goalLower);
      if (wantsCart) {
        const searchAddToCartBtn = nodes.find(n => {
          const name = (n.name || "").toLowerCase().trim();
          return name === "add to cart" || name === "add to bag";
        });
        if (searchAddToCartBtn) {
          return {
            type: "CLICK",
            target: { id: searchAddToCartBtn.id, name: searchAddToCartBtn.name },
            description: `Clicked Add to Cart button on search results card via heuristics`
          };
        }
      }

      return {
        type: "CLICK",
        target: { id: best.id, name: best.name },
        description: `Clicked matching product "${best.name}" in search results via heuristics`
      };
    }
  }

  // =========================================================================
  // 5. PRODUCT DETAILS PAGE -> VARIANT SELECTION & ADD TO CART
  // =========================================================================
  const isAmazonProductPage = isAmazon && (urlLower.includes("/dp/") || urlLower.includes("/gp/product/"));
  const isFlipkartProductPage = isFlipkart && (urlLower.includes("/p/") || urlLower.includes("/product/"));
  const isMyntraProductPage = isMyntra && (urlLower.includes("/buy") || nodes.some(n => (n.name || "").toLowerCase().includes("add to bag")));
  const isMeeshoProductPage = isMeesho && (urlLower.includes("/p/") || nodes.some(n => (n.name || "").toLowerCase().includes("add to cart")));

  if (isAmazonProductPage || isFlipkartProductPage || isMyntraProductPage || isMeeshoProductPage) {
    // 5a. Check if already added to cart
    const goToCartBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      return (
        name.includes("go to cart") ||
        name.includes("view cart") ||
        name.includes("go to bag") ||
        name.includes("view bag") ||
        name.includes("added to cart") ||
        name.includes("added to your cart") ||
        name.includes("item added") ||
        name.includes("proceed to checkout") ||
        name === "in bag"
      );
    });

    if (goToCartBtn) {
      return {
        type: "COMPLETE",
        summary: "Product is successfully added to cart (Quantity: strictly 1)."
      };
    }

    // 5b. Strictly Enforce Quantity = 1 if quantity selector is present
    const qtyMatch = goal.match(/(?:quantity|qty)\s*(?:is|of|:)?\s*(\d+)/i) || goal.match(/\b(\d+)\s*(?:items|units|pieces|quantities)\b/i);
    const requestedQty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    const qtySelector = nodes.find(n => {
      const name = (n.name || "").toLowerCase();
      const id = (n.id || "").toLowerCase();
      return (n.role === "combobox" || n.role === "listbox" || n.role === "textbox") && (name.includes("quantity") || id.includes("quantity") || id === "selectquantity");
    });
    if (qtySelector && qtySelector.value && qtySelector.value !== String(requestedQty)) {
      return {
        type: "SELECT",
        target: { id: qtySelector.id, name: qtySelector.name },
        value: String(requestedQty),
        description: `Set quantity strictly to ${requestedQty} via heuristics`
      };
    }

    // 5b. Color Variant Selection (e.g. Black / Graphite)
    const requestsBlack = goalLower.includes("black") || goalLower.includes("graphite") || goalLower.includes("dark");
    const requestsWhite = goalLower.includes("white") || goalLower.includes("pale grey") || goalLower.includes("silver");

    if (requestsBlack || requestsWhite) {
      const targetColorKeywords = requestsBlack ? ["graphite", "black", "dark"] : ["white", "pale grey", "silver", "grey"];
      
      const variantSwatch = nodes.find(n => {
        const name = (n.name || "").toLowerCase();
        if (name.includes("out of stock") || name.includes("unavailable")) return false;
        return targetColorKeywords.some(kw => name.includes(kw)) && (n.role === "button" || n.role === "radio" || n.role === "img" || n.role === "link");
      });

      if (variantSwatch && !variantSwatch.name?.toLowerCase().includes("selected")) {
        if (variantSwatch.name?.toLowerCase().includes("color") || variantSwatch.name?.toLowerCase().includes("graphite") || variantSwatch.name?.toLowerCase().includes("black")) {
          return {
            type: "CLICK",
            target: { id: variantSwatch.id, name: variantSwatch.name },
            description: `Selected "${variantSwatch.name}" color variant via heuristics`
          };
        }
      }
    }

    // 5c. Fashion Size Selection (for Myntra / Meesho apparel)
    if (isMyntra || isMeesho) {
      const sizeSwatch = nodes.find(n => {
        const name = (n.name || "").toUpperCase().trim();
        const isSizeBtn = ["S", "M", "L", "XL", "XXL", "FREE SIZE"].includes(name);
        return isSizeBtn && (n.role === "button" || n.role === "radio");
      });
      if (sizeSwatch && !sizeSwatch.name?.toLowerCase().includes("selected")) {
        const hasAddToCart = nodes.some(n => {
          const name = (n.name || "").toLowerCase().trim();
          return name.includes("add to cart") || name.includes("add to bag");
        });
        if (hasAddToCart) {
          return {
            type: "CLICK",
            target: { id: sizeSwatch.id, name: sizeSwatch.name },
            description: `Selected size "${sizeSwatch.name}" before adding to cart via heuristics`
          };
        }
      }
    }

    // 5d. Add to Cart Button Execution
    if (observation.productContext?.addToCartNodeId) {
      const targetNode = nodes.find(n => n.id === observation.productContext.addToCartNodeId);
      if (targetNode) {
        return {
          type: "CLICK",
          target: { id: targetNode.id, name: targetNode.name || "Add to Cart" },
          description: `Clicked Add to Cart button on ${hostname} via fast heuristics!`
        };
      }
    }

    // Text or name matching (strictly avoid "Buy Now", "Place Order", "Buy with EMI")
    const cartBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      if (name.includes("buy now") || name.includes("place order") || name.includes("buy with emi")) return false;
      return (
        name.includes("add to cart") ||
        name.includes("add to bag") ||
        name === "cart" ||
        name.includes("add item")
      );
    });

    if (cartBtn) {
      return {
        type: "CLICK",
        target: { id: cartBtn.id, name: cartBtn.name || "Add to Cart" },
        description: `Clicked Add to Cart button on ${hostname} via fast heuristics!`
      };
    }
  }

  // =========================================================================
  // 6. CESC & UTILITY BILL PAYMENT
  // =========================================================================
  if (goalLower.includes("cesc") && goalLower.includes("pay")) {
    if (!hostname.includes("cesc.co.in")) {
      return {
        type: "NAVIGATE",
        url: "https://www.cesc.co.in/",
        description: "Navigated to CESC website to pay bill"
      };
    } else {
      const payLink = nodes.find(n => 
        n.name && (n.name.toLowerCase().includes("monthly bill") || n.name.toLowerCase().includes("quick pay"))
      );
      if (payLink) {
        return {
          type: "CLICK",
          target: { id: payLink.id, name: payLink.name },
          description: "Clicked Quick Pay / Monthly Bill link via heuristics"
        };
      }
    }
  }

  return null;
}
