import { Response } from 'express';

export interface AdminRealtimeEvent {
  type: 'new_order' | 'order_updated' | 'pospal_sync' | 'delivery_updated' | 'refund_updated' | 'exception_flagged';
  title: string;
  message: string;
  orderCode?: string;
  severity?: 'info' | 'warning' | 'critical';
  timestamp: string;
}

class AdminEventHub {
  private clients = new Set<Response>();

  subscribe(res: Response): void {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  emit(event: AdminRealtimeEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}

export const adminEvents = new AdminEventHub();
