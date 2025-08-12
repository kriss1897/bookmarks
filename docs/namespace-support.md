# SSE Namespace Support

This implementation now supports namespaces for Server-Sent Events (SSE), allowing clients to subscribe to specific channels and only receive events relevant to them.

## How It Works

### Client-Side
1. **Namespace Selection**: When the client loads, they first see a namespace selector
2. **Connection**: After selecting a namespace, the client connects to `/api/events?namespace=<namespace>`
3. **Event Filtering**: The client only receives events targeted to their namespace

### Server-Side
1. **Namespace Tracking**: Server tracks connections by namespace
2. **Event Broadcasting**: Events can be sent to all clients or specific namespaces
3. **Admin Operations**: Cleanup and monitoring can target specific namespaces

## API Endpoints

### SSE Connection
```
GET /api/events?namespace=<namespace>
```
Connects to SSE stream for the specified namespace.

### Trigger Events
```
POST /api/trigger
{
  "message": "Your message",
  "namespace": "target-namespace",  // Optional - if omitted, sends to all
  "data": { ... }
}
```

### Send Notifications
```
POST /api/notify
{
  "title": "Notification Title",
  "body": "Notification Body",
  "type": "info|success|warning|error",
  "namespace": "target-namespace"  // Optional - if omitted, sends to all
}
```

### Get Connection Count
```
GET /api/connections?namespace=<namespace>  // Optional - if omitted, returns total
```

### Force Cleanup
```
POST /api/cleanup
{
  "namespace": "target-namespace"  // Optional - if omitted, cleans all connections
}
```

## Example Usage

### Different Clients, Different Namespaces
1. Client A connects to namespace "bookmarks"
2. Client B connects to namespace "notifications"
3. Client C connects to namespace "bookmarks"

### Targeted Events
- Event sent to "bookmarks" → Client A and C receive it, Client B doesn't
- Event sent to "notifications" → Only Client B receives it
- Event sent without namespace → All clients receive it

### Monitoring
- `GET /api/connections?namespace=bookmarks` → Returns 2 (Client A & C)
- `GET /api/connections` → Returns 3 (all clients)

### Admin Operations
- `POST /api/cleanup {"namespace": "bookmarks"}` → Disconnects Client A & C only
- `POST /api/cleanup {}` → Disconnects all clients

## Predefined Namespaces

The client includes some predefined namespace options:
- `bookmarks` - For bookmark-related events
- `notifications` - For general notifications
- `chat` - For chat/messaging events
- `updates` - For system updates

Users can also enter custom namespace names.

## Automatic Reconnection

When server cleanup occurs:
1. Server sends cleanup notification to targeted namespace(s)
2. Affected clients detect the cleanup event
3. Clients automatically reconnect with longer delay (3 seconds vs 1 second)
4. This prevents first-reconnection failures

## Benefits

1. **Isolation**: Events are isolated to relevant clients
2. **Scalability**: Reduced network traffic (clients only get relevant events)
3. **Organization**: Clear separation of different types of events
4. **Debugging**: Easy to monitor and debug specific namespace activity
5. **Administration**: Granular control over connections and cleanup
