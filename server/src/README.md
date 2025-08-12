# API Endpoints for Event-Driven SSE

The server now supports event-driven SSE messages instead of timer-based messages. Here are the available endpoints:

## SSE Connection
- **GET** `/api/events` - Establish Server-Sent Events connection

## API Endpoints

### Status Endpoints
- **GET** `/api/status` - Get API server status
- **GET** `/api/health` - Health check endpoint

### Event Trigger Endpoints
- **POST** `/api/trigger` - Trigger an SSE event to all connected clients
- **POST** `/api/notify` - Send a notification event to all connected clients

## Usage Examples

### Trigger a custom event
```bash
curl -X POST http://localhost:3000/api/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Custom event triggered!",
    "data": {
      "userId": 123,
      "action": "button_click"
    }
  }'
```

### Send a notification
```bash
curl -X POST http://localhost:3000/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New Message",
    "body": "You have received a new message",
    "type": "info"
  }'
```

## SOLID Principles Implementation

### Single Responsibility Principle (SRP)
- `SSEManager`: Only manages SSE connections and broadcasting
- `EventPublisher`: Only publishes events
- `APIRoutes`: Only handles API route logic
- `SSERoutes`: Only handles SSE connection setup

### Open/Closed Principle (OCP)
- New event types can be added without modifying existing code
- New route handlers can be added by extending the system

### Liskov Substitution Principle (LSP)
- Interfaces can be implemented by different classes without breaking functionality
- `IEventPublisher` and `ISSEManager` interfaces enable substitution

### Interface Segregation Principle (ISP)
- Small, focused interfaces: `IEventPublisher`, `ISSEManager`
- Clients only depend on interfaces they actually use

### Dependency Inversion Principle (DIP)
- High-level modules depend on abstractions (interfaces)
- Dependencies are injected via constructor injection
- `DIContainer` manages all dependencies and their lifecycle

## Architecture Benefits

1. **Testability**: Each component can be unit tested independently
2. **Maintainability**: Changes to one component don't affect others
3. **Extensibility**: Easy to add new event types or route handlers
4. **Scalability**: Clear separation of concerns allows for easy scaling
5. **Reusability**: Components can be reused in different contexts
