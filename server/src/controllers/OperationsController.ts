import { Request, Response } from 'express';

import { EventPublisher } from '../events/EventPublisher.js';
import { OperationsService } from '../services/operationsService.js';

const NODE_OPERATIONS = {
  create_folder: 'folder_created',
  create_bookmark: 'bookmark_created',
  open_folder: 'folder_opened',
  close_folder: 'folder_closed',

  move_node: 'item_moved',
  move_item_to_folder: 'item_moved',
  remove_node: 'remove_node'
};

export class OperationsController {
  private operationsService: OperationsService;
  private eventPublisher: EventPublisher;

  constructor(eventsPublisher: EventPublisher, operationsService: OperationsService) {
    this.operationsService = operationsService;
    this.eventPublisher = eventsPublisher;
  }

  getOperations = async (req: Request, res: Response) => {
    try {
      const limit = parseInt((req.query.limit as string) || '100', 10);
      const ops = await this.operationsService.getOperations(limit);
      res.json({ success: true, data: ops });
    } catch (error) {
      console.error('Error fetching operations:', error);
      res.status(500).json({ success: false, message: 'Internal server error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  };

  applyOperation = async (req: Request, res: Response) => {
    try {
      const { namespace } = req.params;
      const envelope = req.body as { id?: string; ts?: number; op?: { type?: string;[k: string]: unknown } };

      if (!envelope || !envelope.id || !envelope.ts || !envelope.op || !envelope.op.type) {
        return res.status(400).json({ success: false, message: 'Invalid operation envelope: id, ts and op.type are required' });
      }

      console.log(envelope);

      const result = await this.operationsService.applyOperationEnvelope(namespace, envelope as any);

      if (result.success) {
        this.eventPublisher.publishToNamespace(namespace, envelope);

        return res.json(result);
      }

      return res.status(400).json(result);
    } catch (error) {
      console.error('Error applying operation:', error);
      return res.status(500).json({ success: false, message: 'Internal server error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}

export default OperationsController;
