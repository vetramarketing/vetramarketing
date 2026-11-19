// Node-only durable booking journal. Never put this directory under public/.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Order, OrderShipment } from '../orders';
import type { ShippingConfiguration } from './config';
import { ShippingError } from './errors';
import {
  flashOrderParameters,
  flashRequestFingerprint,
  type FlashClient,
  type FlashLabelSize,
} from './flash';

interface Intent {
  version: 1;
  orderId: string;
  requestId: string;
  outTradeNo: string;
  fingerprint: string;
  createdAt: string;
}
interface BookedOutcome {
  status: 'booked';
  shipment: OrderShipment;
}
interface UnconfirmedOutcome {
  status: 'unconfirmed';
  errorCode: string;
  carrierCode?: number;
  recordedAt: string;
}
type Outcome = BookedOutcome | UnconfirmedOutcome;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function isExisting(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST';
}
function reconciliation(): ShippingError {
  return new ShippingError(
    'BOOKING_NEEDS_RECONCILIATION',
    'This shipment was already attempted. Check its result with Flash before booking again.',
    409,
  );
}

/** Exclusive create plus fsync: no carrier request happens without a durable intent. */
async function writeNewText(file: string, text: string): Promise<void> {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeNewJson(file: string, value: unknown): Promise<void> {
  return writeNewText(file, JSON.stringify(value));
}
async function writeOutcome(directory: string, outcome: Outcome): Promise<void> {
  const json = JSON.stringify(outcome);
  await writeNewText(path.join(directory, 'outcome.json'), json);
  // Readers only accept a complete, fsynced outcome with a matching commit marker.
  // Exclusive immutable files also work on Windows filesystems without atomic rename.
  await writeNewText(path.join(directory, 'committed'), digest(json));
}

/** Private journals are runtime data, never source assets for Next output tracing. */
async function readJournalFile(file: string): Promise<string> {
  return readFile(/* turbopackIgnore: true */ file, 'utf8');
}

export interface BookingResult {
  shipment: OrderShipment;
  mode: ShippingConfiguration['mode'];
  reused: boolean;
}

export class LocalShippingLedger {
  private readonly root: string;

  constructor(
    private readonly config: ShippingConfiguration,
    private readonly client: FlashClient,
    options: { directory?: string; now?: () => Date } = {},
  ) {
    // Keep the production path statically scoped. The injected directory is only
    // for isolated tests, and neither branch is an application deployment asset.
    this.root = options.directory
      ? path.join(
          /* turbopackIgnore: true */ options.directory,
          config.mode,
          digest(config.merchantId),
        )
      : path.join(
          /* turbopackIgnore: true */ process.cwd(),
          '.local-data',
          'shipping',
          config.mode,
          digest(config.merchantId),
        );
    this.now = options.now ?? (() => new Date());
  }
  private readonly now: () => Date;

  private directory(orderId: string): string {
    return path.join(this.root, digest(orderId));
  }

  private async existing(
    directory: string,
    orderId: string,
    fingerprint?: string,
  ): Promise<BookedOutcome> {
    let intent: Intent;
    let outcome: Outcome;
    try {
      intent = JSON.parse(await readJournalFile(path.join(directory, 'intent.json'))) as Intent;
      if (intent.version !== 1 || intent.orderId !== orderId || !intent.fingerprint)
        throw reconciliation();
      if (fingerprint && intent.fingerprint !== fingerprint) {
        throw new ShippingError(
          'BOOKING_DETAILS_CHANGED',
          'The shipping details changed after this booking was attempted. Reconcile the original shipment with Flash first.',
          409,
        );
      }
      const json = await readJournalFile(path.join(directory, 'outcome.json'));
      const committed = await readJournalFile(path.join(directory, 'committed'));
      if (digest(json) !== committed) throw reconciliation();
      outcome = JSON.parse(json) as Outcome;
    } catch (error) {
      if (error instanceof ShippingError) throw error;
      throw reconciliation();
    }
    if (
      !outcome ||
      typeof outcome !== 'object' ||
      outcome.status !== 'booked' ||
      outcome.shipment?.source !== 'flash-api' ||
      outcome.shipment.requestId !== orderId ||
      outcome.shipment.mode !== this.config.mode ||
      !/^[A-Za-z0-9]{1,20}$/.test(outcome.shipment.trackingNumber)
    )
      throw reconciliation();
    return outcome;
  }

  async book(order: Order): Promise<BookingResult> {
    const parameters = flashOrderParameters(order);
    const fingerprint = flashRequestFingerprint(parameters, order.companyId);
    const directory = this.directory(order.id);
    // A saved/manual tracking number must never silently create another parcel.
    if (order.trackingNumber || order.shipment) {
      try {
        const prior = await this.existing(directory, order.id, fingerprint);
        return { shipment: prior.shipment, mode: this.config.mode, reused: true };
      } catch {
        throw new ShippingError(
          'ORDER_ALREADY_TRACKED',
          'This order already has tracking. Reconcile that shipment before booking another.',
          409,
        );
      }
    }
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isExisting(error))
        throw new ShippingError(
          'SHIPPING_STORAGE_FAILED',
          'The local shipment journal could not be saved. No booking was sent.',
          503,
        );
      const prior = await this.existing(directory, order.id, fingerprint);
      return { shipment: prior.shipment, mode: this.config.mode, reused: true };
    }
    const intent: Intent = {
      version: 1,
      orderId: order.id,
      requestId: order.id,
      outTradeNo: parameters.outTradeNo,
      fingerprint,
      createdAt: this.now().toISOString(),
    };
    try {
      await writeNewJson(path.join(directory, 'intent.json'), intent);
    } catch {
      throw new ShippingError(
        'SHIPPING_STORAGE_FAILED',
        'The local shipment journal could not be saved. No booking was sent.',
        503,
      );
    }
    let result: Awaited<ReturnType<FlashClient['create']>>;
    try {
      result = await this.client.create(parameters);
      if (
        result.outTradeNo !== parameters.outTradeNo ||
        !/^[A-Za-z0-9]{1,20}$/.test(result.trackingNumber)
      ) {
        throw reconciliation();
      }
    } catch (error) {
      // Retain even confirmed rejection until reviewed. No implicit new references/retries.
      await writeOutcome(directory, {
        status: 'unconfirmed',
        errorCode: error instanceof ShippingError ? error.code : 'FLASH_CONNECTION_UNKNOWN',
        ...(error instanceof ShippingError && error.carrierCode !== undefined
          ? { carrierCode: error.carrierCode }
          : {}),
        recordedAt: this.now().toISOString(),
      }).catch(() => undefined);
      if (error instanceof ShippingError) throw error;
      throw reconciliation();
    }
    const shipment: OrderShipment = {
      source: 'flash-api',
      trackingNumber: result.trackingNumber,
      requestId: order.id,
      bookedAt: this.now().toISOString(),
      mode: this.config.mode,
    };
    try {
      await writeOutcome(directory, { status: 'booked', shipment });
    } catch {
      // The parcel may exist even if the filesystem failed; never report safe-to-retry.
      throw reconciliation();
    }
    return { shipment, mode: this.config.mode, reused: false };
  }

  async label(orderId: string, size: FlashLabelSize): Promise<Uint8Array> {
    const booked = await this.existing(this.directory(orderId), orderId);
    return this.client.label(booked.shipment.trackingNumber, size);
  }
}
