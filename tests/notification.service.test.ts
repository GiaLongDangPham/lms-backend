import { describe, expect, it } from 'vitest';
import type { Principal } from '../src/modules/b1/auth.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import type { NotificationRepository } from '../src/modules/notifications/notification.repository.js';

describe('NotificationService.list', () => {
  it('returns the whole-inbox unread count independently of the current page', async () => {
    const repository = {
      async listForRecipient() {
        return [{
          id: '80000000-0000-4000-8000-000000000001',
          recipient_id: '10000000-0000-4000-8000-000000000004',
          assignment_id: '50000000-0000-4000-8000-000000000001',
          kind: 'ASSIGNMENT_CREATED' as const,
          title: 'Bài tập mới', body: 'Nội dung', read_at: null,
          created_at: new Date('2026-11-21T01:00:00Z'),
          cursor_created_at: '2026-11-21T01:00:00.000000Z',
        }];
      },
      async countUnread() { return 7; },
    } as unknown as NotificationRepository;
    const principal = { sessionId: 'session', user: {
      id: '10000000-0000-4000-8000-000000000004', school_code: 'SV001',
      full_name: 'Sinh viên', email: null, role: 'STUDENT', is_active: true,
      must_change_password: false, created_at: new Date('2026-01-01T00:00:00Z'),
    } } as Principal;

    await expect(new NotificationService(repository).list(principal,undefined,1))
      .resolves.toMatchObject({ unreadCount:7,items:[{ title:'Bài tập mới' }] });
  });
});
