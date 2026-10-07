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
    // Find the best product link, avoiding cases/covers
    const validLinks = nodes.filter(n => {
      if (n.role !== "link") return false;
      const name = (n.name || "").toLowerCase();
      // Skip pagination, headers, nav
      if (!name || name.length < 20 || name.includes("customer review")) return false;
      // Skip accessories
      if (name.includes("case") || name.includes("cover") || name.includes("protector") || name.includes("guard")) return false;
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

  // Amazon Product Page (Add to Cart)
  if (isAmazon && (urlLower.includes("/dp/") || urlLower.includes("/gp/product/"))) {
    const cartBtn = nodes.find(n => 
      n.name && (n.name.toLowerCase() === "add to cart" || n.name.toLowerCase() === "add to shopping cart")
    );
    if (cartBtn) {
      return {
        type: "CLICK",
        target: { id: cartBtn.id, name: cartBtn.name },
        description: "Clicked Add to Cart button via fast heuristics!"
      };
    }
  }

  // Flipkart Search Results
  if (isFlipkart && urlLower.includes("search?q=")) {
    const productLink = nodes.find(n => n.role === "link" || (n.href && n.href.includes("/p/")));
    if (productLink) {
      return {
        type: "CLICK",
        target: { id: productLink.id, name: productLink.name },
        description: "Clicked first product link in search results via heuristics"
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
