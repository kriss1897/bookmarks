import { EventPublisher } from './services/EventPublisher.js';
import { EventsManager } from './services/EventsManager.js';

// Create a simple test script to send test events
const eventsManager = new EventsManager();
const publisher = new EventPublisher(eventsManager);

// Send a test bookmark creation event
console.log('Sending test bookmark creation event...');
publisher.publishEvent('bookmark_created', {
  type: 'bookmark_created',
  message: 'Test bookmark created via SSE',
  data: {
    id: 'test-bookmark-' + Date.now(),
    title: 'Test Bookmark from SSE',
    url: 'https://example.com',
    parentId: null,
    index: 'a0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
});

// Send a test sync status event
console.log('Sending test sync status event...');
publisher.publishEvent('sync_status', {
  status: 'syncing',
  message: 'Testing SSE connectivity'
});

console.log('Test events sent successfully!');
