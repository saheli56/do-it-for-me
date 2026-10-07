import type { AgentAction } from "@difm/shared";

export function evaluateHeuristics(goal: string, observation: any): AgentAction | null {
  const goalLower = goal.toLowerCase();
  
  let urlObj: URL;
  try {
    urlObj = new URL(observation.url || "about:blank");
  } catch {
    urlObj = new URL("about:blank");
  }

  const hostname = urlObj.hostname.toLowerCase();
  const pathname = urlObj.pathname.toLowerCase();
  const urlLower = (observation.url || "").toLowerCase();

  const isHomepage = pathname === "/" || pathname === "";
  const isAmazon = hostname.includes("amazon.in") || hostname.includes("amazon.com");
  const isFlipkart = hostname.includes("flipkart.com");
  const isMyntra = hostname.includes("myntra.com");

  const isShoppingHomepage = isHomepage && (isAmazon || isFlipkart || isMyntra);
  const isShoppingSearchIntent = ["compare", "buy", "watch", "search", "purchase", "cart"].some(w => goalLower.includes(w));

  const nodes: any[] = observation.interactiveNodes || [];

  // Amazon / Flipkart / Myntra (Search)
  if (isShoppingHomepage && isShoppingSearchIntent) {
    const searchBox = nodes.find(n => 
      n.role === "textbox" || n.role === "combobox" || n.role === "search" || 
      (n.name && n.name.toLowerCase().includes("search")) ||
      (n.placeholder && n.placeholder.toLowerCase().includes("search"))
    );

    if (searchBox) {
      // Extract main query
      let query = goalLower.replace(/^(search for|buy|purchase|find|add to cart)\s+/i, "").trim();
      query = query.replace(/(on amazon|from amazon|in amazon).*/i, "").trim();
      
      // Also simulate clicking the search button if we can find it
      const searchBtn = nodes.find(n => n.name && (n.name.toLowerCase() === "go" || n.name.toLowerCase() === "search"));

      if (searchBtn) {
         // Return a TYPE action. The executor in App.tsx will need to press enter or click the button. 
         // For now, typing is enough if it hits enter.
      }

      return {
        type: "TYPE",
        target: { id: searchBox.id, name: searchBox.name },
        text: query,
        description: `Typed "${query}" into search box via fast heuristics`
      };
    }
  }

  // Amazon Search Results
  if (isAmazon && urlLower.includes("s?k=")) {
    let queryWords: string[] = [];
    try {
      const kParam = urlObj.searchParams.get("k");
      if (kParam) queryWords = kParam.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    } catch (e) {}

    const validLinks = nodes.filter(n => {
      if (n.role !== "link") return false;
      const name = (n.name || "").toLowerCase();
      if (!name || name.length < 20 || name.includes("customer review")) return false;
      if (name.includes("case") || name.includes("cover") || name.includes("protector") || name.includes("guard")) return false;
      
      if (queryWords.length > 0) {
        const matches = queryWords.filter(w => name.includes(w));
        if (matches.length === 0) return false;
      }
      return true;
    });

    if (validLinks.length > 0) {
      return {
        type: "CLICK",
        target: { id: validLinks[0].id, name: validLinks[0].name },
        description: "Clicked best matching product link in search results via fast heuristics"
      };
    }
  }

  // Amazon & Flipkart Product Page (Add to Cart)
  const isAmazonProductPage = isAmazon && (urlLower.includes("/dp/") || urlLower.includes("/gp/product/"));
  const isFlipkartProductPage = isFlipkart && urlLower.includes("/p/");
  
  if (isAmazonProductPage || isFlipkartProductPage) {
    const goToCartBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      return name.includes("go to cart") || name.includes("view cart");
    });

    if (goToCartBtn) {
      return {
        type: "COMPLETE",
        summary: "Product is already in the cart."
      };
    }

    // 1. High confidence: detected from product context
    if (observation.productContext?.addToCartNodeId) {
      const targetNode = nodes.find(n => n.id === observation.productContext.addToCartNodeId);
      if (targetNode) {
        return {
          type: "CLICK",
          target: { id: targetNode.id, name: targetNode.name || "Add to Cart" },
          description: `Clicked Add to Cart button on ${isAmazon ? "Amazon" : "Flipkart"} via fast heuristics!`
        };
      }
    }

    // 2. Text or name matching
    const cartBtn = nodes.find(n => {
      const name = (n.name || "").toLowerCase().trim();
      if (name.includes("buy now") || name.includes("place order") || name.includes("buy with emi")) return false;
      return name.includes("add to cart") || name.includes("add to bag") || name === "cart";
    });
    if (cartBtn) {
      return {
        type: "CLICK",
        target: { id: cartBtn.id, name: cartBtn.name || "Add to Cart" },
        description: `Clicked Add to Cart button on ${isAmazon ? "Amazon" : "Flipkart"} via fast heuristics!`
      };
    }
  }

  // Flipkart Search Results
  if (isFlipkart && urlLower.includes("search?q=")) {
    let queryWords: string[] = [];
    try {
      const qParam = urlObj.searchParams.get("q");
      if (qParam) queryWords = qParam.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    } catch (e) {}

    const validLinks = nodes.filter(n => {
      const isProductLink = n.role === "link" || (n.href && n.href.includes("/p/"));
      if (!isProductLink) return false;
      const name = (n.name || "").toLowerCase();
      if (!name || name.length < 15) return false;
      if (name.includes("case") || name.includes("cover") || name.includes("protector") || name.includes("guard")) return false;
      
      if (queryWords.length > 0) {
        const matches = queryWords.filter(w => name.includes(w));
        if (matches.length === 0) return false;
      }
      return true;
    });

    if (validLinks.length > 0) {
      return {
        type: "CLICK",
        target: { id: validLinks[0].id, name: validLinks[0].name },
        description: "Clicked best matching product link in search results via heuristics"
      };
    }
  }

  // CESC (Utility Bill)
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
