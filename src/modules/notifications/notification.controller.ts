import type { Response } from 'express';
import type { Principal } from '../b1/auth.js';
import { NotificationService } from './notification.service.js';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  async list(response: Response, principal: Principal, cursor: string | undefined, limit: number) {
    response.json(await this.service.list(principal, cursor, limit));
  }

  async markRead(response: Response, principal: Principal, notificationId: string) {
    response.json(await this.service.markRead(principal, notificationId));
  }
}
