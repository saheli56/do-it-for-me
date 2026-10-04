import type { AgentAction } from "@difm/shared";

export function evaluateHeuristics(goal: string, observation: any): AgentAction | null {
  const goalLower = goal.toLowerCase();
  
  // Safely parse URL
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
  const isShoppingSearchIntent = ["compare", "buy", "watch", "search"].some(w => goalLower.includes(w));

  const nodes: any[] = observation.interactiveNodes || [];

  // Amazon / Flipkart / Myntra (Search)
  if (isShoppingHomepage && isShoppingSearchIntent) {
    const searchBox = nodes.find(n => 
      n.role === "textbox" || 
      n.role === "combobox" || 
      n.role === "search" || 
      (n.name && n.name.toLowerCase().includes("search")) ||
      (n.placeholder && n.placeholder.toLowerCase().includes("search"))
    );

    if (searchBox) {
      let query = goalLower.replace(/^(search for|buy|compare)\s+/i, "").trim();
      if (!query) query = goalLower;

      return {
        type: "TYPE",
        target: { id: searchBox.id, name: searchBox.name },
        text: query,
        description: `Typed "${query}" into search box via heuristics`
      };
    }
  }

  // Amazon / Flipkart / Myntra (Add to Cart)
  if (isAmazon || isFlipkart || isMyntra) {
    if (observation.productContext?.addToCartNodeId) {
      return {
        type: "CLICK",
        target: { id: observation.productContext.addToCartNodeId },
        description: "Clicked Add to Cart button from product context"
      };
    }
    
    const cartBtn = nodes.find(n => 
      n.name && (n.name.toLowerCase().includes("add to cart") || n.name.toLowerCase().includes("add to bag"))
    );
    if (cartBtn) {
      return {
        type: "CLICK",
        target: { id: cartBtn.id, name: cartBtn.name },
        description: "Clicked Add to Cart fallback button via heuristics"
      };
    }
  }

  // Flipkart (Search Results)
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
