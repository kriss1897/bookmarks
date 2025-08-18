import { Request, Response } from 'express';
import { BookmarkService } from '../services/bookmarksService.js';
import { EventPublisher } from '../events/EventPublisher.js';
import { OperationsService } from '../services/operationsService.js';

export class BookmarkController {
  private bookmarkService: BookmarkService;
  private eventPublisher: EventPublisher;

  private operationsService?: OperationsService;

  constructor(eventPublisher: EventPublisher, bookmarkService: BookmarkService, operationsService?: OperationsService) {
    this.bookmarkService = bookmarkService;
    this.eventPublisher = eventPublisher;
    this.operationsService = operationsService;
  }

  getNodeTree = async (req: Request, res: Response) => {
    try {
      const { namespace, nodeId } = req.params;

      if (nodeId === 'root') {
        const root = await this.bookmarkService.getRootNode(namespace);

        if (!root) {
          const nodeData = {
            id: 'root',
            parentId: null,
            orderKey: null,
          };
          const folderData = {
            title: namespace,
            isOpen: true,
          };

          const newNode = await this.bookmarkService.createFolder(
            namespace,
            nodeData,
            folderData
          );

          // Record server-originated creation operation if operationsService available
          if (this.operationsService) {
            await this.operationsService.recordOperation({
              id: `op-create-${newNode.id}-${Date.now()}`,
              namespace,
              type: 'create',
              nodeId: newNode.id,
              data: JSON.stringify(newNode),
              timestamp: new Date(),
              deviceId: 'server',
              sessionId: `session-${Date.now()}`,
            });
          }
        }
      }

      const tree = await this.bookmarkService.getNodeWithChildren(namespace, nodeId);

      if (!tree) {
        return res.status(404).json({ success: false, message: 'Node not found' });
      }

      res.json({ success: true, data: tree, message: 'Tree retrieved successfully with open folder children' });
    } catch (error) {
      console.error('Error fetching node tree:', error);
      res.status(500).json({ success: false, message: 'Internal server error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}

export default BookmarkController;
