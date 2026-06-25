import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { JwtPayload } from "../auth/jwt-auth.guard.js";

/**
 * Real-time push to the seller dashboard (PRD Bagian 12 — live updates).
 * Clients connect with a JWT in the handshake auth and join a per-user room;
 * `emitNewOrder` pushes only to that user's sockets. Served at /socket.io/
 * (proxied by nginx on viewtoko with WS upgrade).
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class EventsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(private readonly jwt: JwtService) {}

  private room(userId: string): string {
    return `user:${userId}`;
  }

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      void client.join(this.room(payload.sub));
      client.emit("connected", { ok: true });
    } catch {
      client.disconnect(true);
    }
  }

  /** Push a newly ingested order to its owner's dashboard. */
  emitNewOrder(userId: string, order: unknown): void {
    this.server?.to(this.room(userId)).emit("new_order", order);
  }

  /** Push a fulfillment-status change. */
  emitOrderUpdate(userId: string, order: unknown): void {
    this.server?.to(this.room(userId)).emit("order_update", order);
  }
}
