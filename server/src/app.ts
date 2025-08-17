import express, { Request, Response } from 'express';
import cors from 'cors';
import { initializeDatabase } from './db/index.js';
import { BookmarkService } from './db/service.js';
import { EventsManager } from './services/EventsManager.js';
import { EventPublisher } from './services/EventPublisher.js';
import { EventsController } from './controllers/EventsController.js';

const app = express();
const bookmarkService = new BookmarkService();

// Initialize database on startup
await initializeDatabase();

// Initialize with sample data if needed
// TODO: Update for namespace support
// await bookmarkService.initializeWithSampleData();

// Initialize SSE services
const eventsManager = new EventsManager();
const eventPublisher = new EventPublisher(eventsManager);
const eventsController = new EventsController(eventsManager);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SSE Events endpoint
app.get('/api/events', eventsController.handleEventsConnection);

// Basic route
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    message: 'Bookmarks API Server',
    version: '1.0.0',
    status: 'running',
    sseConnections: eventsManager.getConnectionCount()
  });
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Get all namespaces and their root nodes
app.get('/api/namespaces', async (req: Request, res: Response) => {
  try {
    const namespaces = await bookmarkService.getAllNamespaces();
    
    res.json({
      success: true,
      data: namespaces,
      message: 'Namespaces retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching namespaces:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get initial tree from database
app.get('/api/:namespace/tree/initial', async (req: Request, res: Response) => {
  try {
    const { namespace } = req.params;
    const tree = await bookmarkService.getSerializedTree(namespace);
    
    if (!tree) {
      return res.status(404).json({
        success: false,
        message: 'No tree data found'
      });
    }

    res.json({
      success: true,
      data: tree,
      message: 'Tree retrieved successfully from database'
    });
  } catch (error) {
    console.error('Error fetching tree:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get tree starting from a specific node, only loading children for open folders
app.get('/api/:namespace/tree/node/:nodeId', async (req: Request, res: Response) => {
  try {
    const { namespace, nodeId } = req.params;

    if (nodeId === 'root') {
      // check if the root node exists in the namespace
      const root = await bookmarkService.getRootNode(namespace);

      // if it does not exist, create a root node
      if (!root) {
        // and create a root folder as well
        await bookmarkService.createFolder(
          namespace,
          {
            id: 'root',
            parentId: null,
            orderKey: null,
          },
          {
            title: namespace,
            isOpen: true,
          }
        );
      }
    }

    const tree = await bookmarkService.getNodeWithChildren(namespace, nodeId);
    
    if (!tree) {
      return res.status(404).json({
        success: false,
        message: 'Node not found'
      });
    }

    res.json({
      success: true,
      data: tree,
      message: 'Tree retrieved successfully with open folder children'
    });
  } catch (error) {
    console.error('Error fetching node tree:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get tree statistics
app.get('/api/:namespace/tree/stats', async (req: Request, res: Response) => {
  try {
    const { namespace } = req.params;
    // TODO: Update service to support namespace
    res.json({
      success: false,
      message: 'Namespace support in progress'
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get operations history
app.get('/api/:namespace/operations', async (req: Request, res: Response) => {
  try {
    const { namespace } = req.params;
    // TODO: Update service to support namespace
    res.json({
      success: false,
      message: 'Namespace support in progress'
    });
  } catch (error) {
    console.error('Error fetching operations:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create a new node
app.post('/api/:namespace/nodes', async (req: Request, res: Response) => {
  try {
    const { namespace } = req.params;
    const { id, parentId, kind, title, url, isOpen, orderKey, description, favicon } = req.body;
    
    if (!kind || !title) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: kind, title'
      });
    }

    let node;
    if (kind === 'folder') {
      node = await bookmarkService.createFolder(
        namespace,
        {
          id,
          parentId: parentId || null,
          orderKey: orderKey || null,
        },
        {
          title,
          isOpen: isOpen !== undefined ? isOpen : true,
        }
      );
    } else if (kind === 'bookmark') {
      if (!url) {
        return res.status(400).json({
          success: false,
          message: 'URL is required for bookmarks'
        });
      }
      
      node = await bookmarkService.createBookmark(
        namespace,
        {
          id,
          parentId: parentId || null,
          orderKey: orderKey || null,
        },
        {
          title,
          url,
          description: description || undefined,
          favicon: favicon || undefined,
        }
      );
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid node kind. Must be "folder" or "bookmark"'
      });
    }

    // Broadcast creation event with flattened payload
    if (kind === 'folder') {
      eventPublisher.publishToNamespace(namespace, {
        type: 'folder_created',
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        isOpen: (node as any).isOpen === true
      });
    } else {
      eventPublisher.publishToNamespace(namespace, {
        type: 'bookmark_created',
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        url: (node as any).url
      });
    }

    res.status(201).json({
      success: true,
      data: node,
      message: 'Node created successfully'
    });
  } catch (error) {
    console.error('Error creating node:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update a node
app.put('/api/:namespace/nodes/:id', async (req: Request, res: Response) => {
  try {
    const { namespace, id } = req.params;
    const { parentId, orderKey, title, url, isOpen, description, favicon } = req.body;
    
    // Separate node updates from specific updates
    const nodeUpdates: any = {};
    const specificUpdates: any = {};
    
    if (parentId !== undefined) nodeUpdates.parentId = parentId;
    if (orderKey !== undefined) nodeUpdates.orderKey = orderKey;
    
    if (title !== undefined) specificUpdates.title = title;
    if (url !== undefined) specificUpdates.url = url;
    if (isOpen !== undefined) specificUpdates.isOpen = isOpen;
    if (description !== undefined) specificUpdates.description = description;
    if (favicon !== undefined) specificUpdates.favicon = favicon;
    
    const node = await bookmarkService.updateNode(namespace, id, nodeUpdates, specificUpdates);
    
    if (!node) {
      return res.status(404).json({
        success: false,
        message: 'Node not found'
      });
    }

    // Broadcast update events
    if (isOpen !== undefined && node.kind === 'folder') {
      // Broadcast explicit open/close event
      eventPublisher.publishToNamespace(namespace, {
        type: isOpen ? 'open_folder' : 'close_folder',
        id: node.id,
        isOpen: !!isOpen
      });
    } else {
      eventPublisher.publishToNamespace(namespace, {
        type: node.kind === 'folder' ? 'folder_updated' : 'bookmark_updated',
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        ...(node.kind === 'bookmark' ? { url: (node as any).url } : {})
      });
    }

    res.json({
      success: true,
      data: node,
      message: 'Node updated successfully'
    });
  } catch (error) {
    console.error('Error updating node:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete a node
app.delete('/api/:namespace/nodes/:id', async (req: Request, res: Response) => {
  try {
    const { namespace, id } = req.params;
    
    // Get node info before deletion for event
    const nodeToDelete = await bookmarkService.getNode(namespace, id);
    
    const deleted = await bookmarkService.deleteNode(namespace, id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Node not found'
      });
    }

    // Broadcast deletion event
    if (nodeToDelete) {
      eventPublisher.publishToNamespace(namespace, {
        type: nodeToDelete.kind === 'folder' ? 'folder_deleted' : 'bookmark_deleted',
        message: `${nodeToDelete.kind} deleted: ${nodeToDelete.title}`,
        nodeId: id,
        data: { id, kind: nodeToDelete.kind, title: nodeToDelete.title }
      });
    }

    res.json({
      success: true,
      message: 'Node deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting node:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get a specific node
app.get('/api/:namespace/nodes/:id', async (req: Request, res: Response) => {
  try {
    const { namespace, id } = req.params;
    const node = await bookmarkService.getNode(namespace, id);
    
    if (!node) {
      return res.status(404).json({
        success: false,
        message: 'Node not found'
      });
    }

    res.json({
      success: true,
      data: node
    });
  } catch (error) {
    console.error('Error fetching node:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Move a node
app.post('/api/:namespace/nodes/:id/move', async (req: Request, res: Response) => {
  try {
    const { namespace, id } = req.params;
    const { newParentId, orderKey } = req.body;
    
    const node = await bookmarkService.moveNode(namespace, id, newParentId, orderKey);
    
    if (!node) {
      return res.status(404).json({
        success: false,
        message: 'Node not found'
      });
    }

    // Broadcast move event with flattened payload
    eventPublisher.publishToNamespace(namespace, {
      type: 'item_moved',
      id: node.id,
      parentId: node.parentId,
      title: node.title
    });

    res.json({
      success: true,
      data: node,
      message: 'Node moved successfully'
    });
  } catch (error) {
    console.error('Error moving node:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Ping endpoint for connectivity checks
app.head('/api/ping', (req: Request, res: Response) => {
  res.status(200).end();
});

// Example route to test SSE broadcasting
app.post('/api/broadcast', (req: Request, res: Response) => {
  const { namespace, type, message, data } = req.body;
  
  if (!namespace || !type) {
    res.status(400).json({ error: 'namespace and type are required' });
    return;
  }
  
  eventPublisher.publishToNamespace(namespace, {
    type,
    message: message || `Test broadcast: ${type}`,
    timestamp: new Date().toISOString(),
    ...data // Spread any additional data fields
  });
  
  res.json({ 
    success: true, 
    message: `Broadcasted ${type} to namespace ${namespace}` 
  });
});

// Apply an operation envelope (client sync)
app.post('/api/:namespace/operations/apply', async (req: Request, res: Response) => {
  try {
    const { namespace } = req.params;
    const envelope = req.body as {
      id?: string;
      ts?: number;
      op?: { type?: string; [k: string]: unknown };
    };

    if (!envelope || !envelope.id || !envelope.ts || !envelope.op || !envelope.op.type) {
      return res.status(400).json({
        success: false,
        message: 'Invalid operation envelope: id, ts and op.type are required'
      });
    }

    const result = await bookmarkService.applyOperationEnvelope(namespace, envelope as any);

    if (result.success) {
      // Broadcast a specific event based on op.type for clients
      const t = envelope.op.type;
      const d: any = result.data || {};
      switch (t) {
        case 'create_folder':
          eventPublisher.publishToNamespace(namespace, {
            type: 'folder_created',
            id: d.id || envelope.op.id,
            parentId: d.parentId ?? envelope.op.parentId ?? null,
            title: d.title ?? envelope.op.title,
            isOpen: d.isOpen ?? envelope.op.isOpen ?? true
          });
          break;
        case 'create_bookmark':
          eventPublisher.publishToNamespace(namespace, {
            type: 'bookmark_created',
            id: d.id || envelope.op.id,
            parentId: d.parentId ?? envelope.op.parentId ?? null,
            title: d.title ?? envelope.op.title,
            url: d.url ?? envelope.op.url
          });
          break;
        case 'move_node':
        case 'move_item_to_folder':
          eventPublisher.publishToNamespace(namespace, {
            type: 'item_moved',
            id: envelope.op.nodeId,
            parentId: d.parentId ?? envelope.op.toFolderId
          });
          break;
        case 'open_folder':
        case 'close_folder': {
          const folderId = (envelope.op as any).folderId;
          const isOpen = t === 'open_folder' ? true : false;

          eventPublisher.publishToNamespace(namespace, {
            type: isOpen ? 'open_folder' : 'close_folder',
            id: folderId,
            isOpen
          });

          break;
        }
        case 'remove_node':
          eventPublisher.publishToNamespace(namespace, {
            type: 'folder_deleted',
            id: (envelope.op as any).nodeId
          });
          break;
        default:
          // Fallback generic operation event
          eventPublisher.publishToNamespace(namespace, {
            type: 'operation',
            operationId: result.operationId,
            op: envelope.op
          });
      }

      return res.json(result);
    }

    return res.status(400).json(result);
  } catch (error) {
    console.error('Error applying operation:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default app;
