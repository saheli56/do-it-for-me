import { describe, it, expect } from "vitest";
import { extractCleanSearchQuery, evaluateHeuristics } from "../src/heuristics.js";

describe("Heuristics Engine Suite", () => {
  describe("Search Query Extraction", () => {
    it("extracts clean query from quoted string", () => {
      const goal = "Search for a 'Logitech MX Master 3S wireless mouse', find the black color option if available, and add it to my cart.";
      const query = extractCleanSearchQuery(goal);
      expect(query).toBe("Logitech MX Master 3S wireless mouse");
    });

    it("cleans natural language prompt without quotes", () => {
      const goal = "search for wireless bluetooth mouse on amazon and add to cart";
      const query = extractCleanSearchQuery(goal);
      expect(query).toBe("wireless bluetooth mouse");
    });

    it("strips store suffixes for myntra and meesho", () => {
      const goal = "buy black cotton t-shirt on myntra";
      const query = extractCleanSearchQuery(goal);
      expect(query).toBe("black cotton t-shirt");

      const meeshoGoal = "search for kurti set from meesho and add to bag";
      const meeshoQuery = extractCleanSearchQuery(meeshoGoal);
      expect(meeshoQuery).toBe("kurti set");
    });

    it("cleans camera prompt with conditional price expression", () => {
      const goal = "Canon EOS R50 V Smartchoice Mirrorless Camera Kit add this product in cart if it's price is less than 70000 .";
      const query = extractCleanSearchQuery(goal);
      expect(query).toBe("Canon EOS R50 V Smartchoice Mirrorless Camera Kit");
    });

    it("cleans sony headphones prompt with 'and to cart' typo and price limit", () => {
      const goal = "search for sony xm5 headphones and to cart if price is below 50000";
      const query = extractCleanSearchQuery(goal);
      expect(query).toBe("sony xm5 headphones");
    });
  });

  describe("Amazon / Flipkart / Myntra / Meesho Cart Scenarios", () => {
    it("detects Amazon homepage search input and types clean query", () => {
      const observation = {
        url: "https://www.amazon.in/",
        title: "Online Shopping site in India",
        interactiveNodes: [
          { id: "twotabsearchtextbox", role: "textbox", name: "Search Amazon.in", placeholder: "Search Amazon.in" }
        ]
      };
      const action = evaluateHeuristics("Search for 'Logitech MX Master 3S wireless mouse' and add to cart", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("TYPE");
      if (action?.type === "TYPE") {
        expect(action.text).toBe("Logitech MX Master 3S wireless mouse");
        expect(action.target.id).toBe("twotabsearchtextbox");
      }
    });

    it("disambiguates Logitech MX Master 3S over MX Anywhere and older 2S on search results", () => {
      const observation = {
        url: "https://www.amazon.in/s?k=Logitech+MX+Master+3S",
        title: "Amazon.in: Logitech MX Master 3S",
        interactiveNodes: [
          { id: "node-1", role: "link", name: "Logitech MX Anywhere 3S Wireless Mouse - Graphite", href: "/dp/B0ANYWHERE" },
          { id: "node-2", role: "link", name: "Logitech MX Master 2S Wireless Mouse - Black", href: "/dp/B0MASTER2S" },
          { id: "node-3", role: "link", name: "Logitech MX Master 3S Wireless Performance Mouse - Graphite Black", href: "/dp/B0MASTER3S" }
        ]
      };
      const action = evaluateHeuristics("Search for 'Logitech MX Master 3S wireless mouse', find black color and add to cart", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("node-3");
      }
    });

    it("clicks direct Add to Cart on search results card when price satisfies target limit", () => {
      const observation = {
        url: "https://www.amazon.in/s?k=Canon+EOS+R50+V+Smartchoice+Mirrorless+Camera+Kit",
        title: "Amazon.in : Canon EOS R50 V Smartchoice Mirrorless Camera Kit",
        productContext: {
          searchResults: [
            {
              nodeId: "node-link-1",
              title: "Canon EOS R50 V Smartchoice Mirrorless Camera Kit with RF-S14-30mm Lens",
              price: "₹62,990",
              priceNumber: 62990
            }
          ]
        },
        interactiveNodes: [
          {
            id: "node-link-1",
            role: "link",
            name: "Canon EOS R50 V Smartchoice Mirrorless Camera Kit with RF-S14-30mm Lens",
            href: "/dp/B0CANONR50"
          },
          {
            id: "btn-search-cart",
            role: "button",
            name: "Add to cart"
          }
        ]
      };
      const action = evaluateHeuristics(
        "Canon EOS R50 V Smartchoice Mirrorless Camera Kit add this product in cart if it's price is less than 70000 .",
        observation
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("btn-search-cart");
      }
    });

    it("halts with COMPLETE if search result product price exceeds target limit", () => {
      const observation = {
        url: "https://www.amazon.in/s?k=Canon+EOS+R50+V+Smartchoice+Mirrorless+Camera+Kit",
        title: "Amazon.in : Canon EOS R50 V Smartchoice Mirrorless Camera Kit",
        productContext: {
          searchResults: [
            {
              nodeId: "node-link-1",
              title: "Canon EOS R50 V Smartchoice Mirrorless Camera Kit with RF-S14-30mm Lens",
              price: "₹79,990",
              priceNumber: 79990
            }
          ]
        },
        interactiveNodes: [
          {
            id: "node-link-1",
            role: "link",
            name: "Canon EOS R50 V Smartchoice Mirrorless Camera Kit with RF-S14-30mm Lens",
            href: "/dp/B0CANONR50"
          },
          {
            id: "btn-search-cart",
            role: "button",
            name: "Add to cart"
          }
        ]
      };
      const action = evaluateHeuristics(
        "Canon EOS R50 V Smartchoice Mirrorless Camera Kit add this product in cart if it's price is less than 70000 .",
        observation
      );
      expect(action).not.toBeNull();
      expect(action?.type).toBe("COMPLETE");
      if (action?.type === "COMPLETE") {
        expect(action.summary).toContain("exceeds the requested price limit");
      }
    });

    it("clicks Add to Cart on Flipkart product page and stops if already in cart", () => {
      const observation = {
        url: "https://www.flipkart.com/logitech-mx-master-3s-mouse/p/itm12345",
        title: "Logitech MX Master 3S Mouse Price in India",
        productContext: {
          addToCartNodeId: "btn-cart"
        },
        interactiveNodes: [
          { id: "btn-cart", role: "button", name: "Add to Cart" }
        ]
      };
      const action = evaluateHeuristics("add to cart", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("btn-cart");
      }

      // If user is already on product page with GO TO CART
      const inCartObservation = {
        url: "https://www.flipkart.com/logitech-mx-master-3s-mouse/p/itm12345",
        title: "Logitech MX Master 3S Mouse",
        interactiveNodes: [
          { id: "btn-go-to-cart", role: "button", name: "GO TO CART" }
        ]
      };
      const completedAction = evaluateHeuristics("add to cart", inCartObservation);
      expect(completedAction?.type).toBe("COMPLETE");
    });

    it("handles Myntra apparel size selection and ADD TO BAG", () => {
      const observation = {
        url: "https://www.myntra.com/tshirts/roadster/men-black-tshirt/123/buy",
        title: "Men Black T-shirt",
        interactiveNodes: [
          { id: "size-m", role: "button", name: "M" },
          { id: "add-to-bag", role: "button", name: "ADD TO BAG" }
        ]
      };
      const action = evaluateHeuristics("buy black t-shirt size M", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("size-m");
      }
    });

    it("handles Meesho product Add to Cart", () => {
      const observation = {
        url: "https://www.meesho.com/classic-mouse/p/9xyz",
        title: "Classic Wireless Mouse",
        interactiveNodes: [
          { id: "meesho-add-cart", role: "button", name: "Add to Cart" }
        ]
      };
      const action = evaluateHeuristics("add to cart", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("meesho-add-cart");
      }
    });
  });

  describe("Order Cancellation & Cart Item Removal", () => {
    it("clicks Remove on cart page when asked to remove item", () => {
      const observation = {
        url: "https://www.amazon.in/gp/cart/view.html",
        title: "Amazon.in Shopping Cart",
        interactiveNodes: [
          { id: "remove-item-1", role: "button", name: "Delete" }
        ]
      };
      const action = evaluateHeuristics("remove this item from cart", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("remove-item-1");
      }
    });

    it("clicks Cancel Order on orders page when asked to cancel order", () => {
      const observation = {
        url: "https://www.flipkart.com/orders/details/OD12345",
        title: "Flipkart Order Details",
        interactiveNodes: [
          { id: "cancel-order-btn", role: "button", name: "Cancel Order" }
        ]
      };
      const action = evaluateHeuristics("cancle this order", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("CLICK");
      if (action?.type === "CLICK") {
        expect(action.target.id).toBe("cancel-order-btn");
      }
    });
  });

  describe("Financial Payment & Safety Enforcement", () => {
    it("strictly halts with REQUEST_APPROVAL on payment screens instead of authorizing payment", () => {
      const observation = {
        url: "https://www.amazon.in/gp/buy/payselect/handlers/display.html",
        title: "Select a payment method",
        interactiveNodes: [
          { id: "pay-now-btn", role: "button", name: "Pay ₹1,299" }
        ]
      };
      const action = evaluateHeuristics("complete purchase and pay", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("REQUEST_APPROVAL");
      if (action?.type === "REQUEST_APPROVAL") {
        expect(action.consequences).toContain("strictly restricts autonomous financial payments");
      }
    });

    it("halts with REQUEST_APPROVAL when Place Order button is encountered at checkout", () => {
      const observation = {
        url: "https://www.flipkart.com/checkout/payment",
        title: "Flipkart Checkout Payment",
        interactiveNodes: [
          { id: "place-order", role: "button", name: "Place Order" }
        ]
      };
      const action = evaluateHeuristics("pay bill or place order", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("REQUEST_APPROVAL");
    });
  });

  describe("Strict Quantity = 1 Enforcement", () => {
    it("never clicks Add to Cart again if already added in earlier step", () => {
      const observation = {
        url: "https://www.amazon.in/s?k=Canon+Camera",
        title: "Amazon.in : Canon Camera",
        interactiveNodes: [
          { id: "btn-cart", role: "button", name: "Add to cart" }
        ]
      };
      const action = evaluateHeuristics("add to cart", observation, { alreadyAddedToCart: true });
      expect(action).not.toBeNull();
      expect(action?.type).toBe("COMPLETE");
      expect(action?.summary).toContain("Quantity: 1");
    });

    it("completes immediately when Added to Cart confirmation drawer is detected", () => {
      const observation = {
        url: "https://www.amazon.in/dp/B0CANON123",
        title: "Canon Camera Details",
        interactiveNodes: [
          { id: "btn-added", role: "button", name: "Added to Cart" }
        ]
      };
      const action = evaluateHeuristics("add to cart", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("COMPLETE");
      expect(action?.summary).toContain("Quantity: strictly 1");
    });

    it("resets quantity selector to 1 if default value is greater than 1", () => {
      const observation = {
        url: "https://www.amazon.in/dp/B0CANON123",
        title: "Canon Camera Details",
        interactiveNodes: [
          { id: "quantity", role: "combobox", name: "Quantity", value: "2" },
          { id: "add-to-cart-button", role: "button", name: "Add to Cart" }
        ]
      };
      const action = evaluateHeuristics("buy camera", observation);
      expect(action).not.toBeNull();
      expect(action?.type).toBe("SELECT");
      if (action?.type === "SELECT") {
        expect(action.value).toBe("1");
      }
    });
  });
});
