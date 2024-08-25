# WebSocket Chat Room Protocol Documentation

## Overview

This protocol defines the communication between the client (web browser) and the server for a real-time chat room
application using WebSockets.

## Connection

The client establishes a WebSocket connection to the server using the following endpoint:

```
wss://bndslpwzjk.execute-api.us-east-1.amazonaws.com/dev
```

## Message Format

All messages exchanged between the client and server are in JSON format.

## Client to Server Messages

### 1. Subscribe to a Topic

When joining a chat room, the client sends a subscribe message:

```json
{
  "action": "subscribe",
  "topic": "<room_topic>"
}
```

- `action`: Always "subscribe" for this message type.
- `topic`: A unique identifier for the chat room.

### 2. Publish a Message

To send a chat message, the client sends a publish message:

```json
{
  "action": "publish",
  "topic": "<room_topic>",
  "message": "<message_content>"
}
```

- `action`: Always "publish" for this message type.
- `topic`: The identifier of the chat room.
- `message`: The content of the chat message.

## Server to Client Messages

### 1. Subscription Confirmation

After a successful subscription, the server sends a confirmation:

```json
{
  "action": "subscribed",
  "topic": "<room_topic>"
}
```

- `action`: Always "subscribed" for this message type.
- `topic`: The topic (room) the client has subscribed to.

### 2. Incoming Chat Message

When a message is published to a room, the server broadcasts it to all subscribed clients:

```json
{
  "action": "message",
  "sender": "<sender_id>",
  "message": "<message_content>"
}
```

- `action`: Always "message" for this message type.
- `sender`: An identifier for the message sender.
- `message`: The content of the chat message.

## Room Topics

Room topics are generated client-side using a combination of random strings. They are shared via URL parameters to allow
users to join specific rooms.

## Error Handling

The server may send error messages in various formats. The client should be prepared to handle and display these
messages appropriately.

## Reconnection

In case of disconnection, the client automatically attempts to reconnect to the WebSocket server after a 3-second delay.

## Notes

- The protocol doesn't include explicit user authentication or authorization.
- Message history is not persisted; only real-time communication is supported.
- The client distinguishes its own messages from others by comparing the `sender` field with its own connection ID.

This documentation provides an overview of the WebSocket protocol used in the chat application. It covers the message
formats, actions, and basic flow of communication between the client and server.
