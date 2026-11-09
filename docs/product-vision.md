# Waythread: Plan your Trips with Friends
## Motivation
When I planned a road trip with friends remotely, I could not find one place to collect our information and build the plan together. Instead, the plan was scattered across an AI-generated draft, a Google Doc, a Google Maps list, social media posts and our group chat, and we relied on memory and chat history to piece it together. 

The pain showed up in four ways:
- **Co-writing an unstructured plan gets messy.** A shared Google Doc has no structure for a road trip, so it quickly turns into a patchwork as everyone edits it their own way.
- **Ideas for the route get lost in the chat.** We share social media posts and AI suggestions in the group chat, and the stream of links and screenshots is hard to look back through.
- **Booking details have to be copied by hand.** We post screenshots of hotel and flight confirmations in the chat, then retype the details into the plan.
- **The plan is hard to follow mid-trip.** On the road, no tool shows us on a phone where we are in the plan and what comes next, so we keep scrolling back through the doc and the chat to find the next stop.
## Solution
Dotsie is a web app to plan and track your trips together with your friends. It does not intend to replace your booking, map, chat or AI chat app. It provides a consolidated place to save the important information about your trip, and an opinionated view to structure and track your trips.

The app has the following core features:

- **A structured plan everyone can co-edit:** A trip is a map and a list of stops. The list shows arrival times and travel time between stops, the map previews the route, and you can search for a place to add as a stop.
- **Ideas saved as stops, not lost in the chat:** Instead of posting links and screenshots in the chat, save ideas straight into the plan as stops, links attached. Add them from map search, which suggests hotspots along your route, or have your AI agent save its recommendations through the MCP server.
- **Booking details imported, not retyped:** Each stop (such as a hotel or airport) holds notes and links. Your AI agent can import bookings through the MCP server into the right stop, or you can add them yourself.
- **Track your trip in real time:** The current stop is highlighted and past stops and routes are greyed out, so you can focus on what comes next.
- **Curated travel guide to get started (TODO):** A curated guide bootstraps your plan, so you do not start from a blank page.

