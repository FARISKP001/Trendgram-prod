/**
 * Example WebSocket client that connects to the Worker chat endpoint.
 * It listens for partner disconnect notifications and proactively
 * notifies the server when the socket closes (refresh/back/close).
 */
const params = new URLSearchParams({
  sessionId: "<CHAT_SESSION_ID>",
  userId: "<USER_ID>",
  userName: "<USER_NAME>",
});

const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/chat?${params.toString()}`);

socket.addEventListener("open", () => {
  console.log("[client] connected to chat server");
});

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "partner_disconnected") {
    console.info("[client] partner disconnected:", data);
    // Show UI notice, enable "Next" button, etc.
  }
});

socket.addEventListener("close", async () => {
  console.log("[client] socket closed, informing worker...");
  await fetch("/chat/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: "<CHAT_SESSION_ID>",
      userId: "<USER_ID>",
    }),
  });
});

window.addEventListener("beforeunload", () => socket.close(1000, "browser_unload"));

