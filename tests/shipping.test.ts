import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Order } from '../src/lib/orders';
import {
  readShippingConfiguration,
  requireLocalShippingRequest,
  type ShippingConfiguration,
} from '../src/lib/shipping/config';
import { ShippingError } from '../src/lib/shipping/errors';
import {
  createFlashClient,
  flashOrderParameters,
  signFlashParameters,
  type FlashClient,
} from '../src/lib/shipping/flash';
import {
  bookFlashShipment,
  downloadFlashLabel,
  shippingCapabilities,
} from '../src/lib/shipping/gateway';
import { LocalShippingLedger } from '../src/lib/shipping/ledger';

const config: ShippingConfiguration = {
  enabled: true,
  origin: 'http://127.0.0.1:3100',
  mode: 'training',
  merchantId: 'TEST-MERCHANT',
  apiKey: 'test-secret-never-printed',
};
const address = {
  name: 'ทดสอบ',
  phone: '0812345678',
  address: '1 ถนนทดสอบ',
  subdistrict: 'บางรัก',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
};
function order(): Order {
  return {
    id: 'order-test-one',
    number: 'ORD-20261105-0001',
    companyId: 'company-one',
    customerName: 'ทดสอบ',
    orderedOn: '2026-11-05',
    items: [{ id: 'item-1', name: 'สินค้า', quantity: 2, unitPriceSatang: 12345 }],
    discountSatang: 100,
    shippingSatang: 5500,
    paymentMethod: 'transfer',
    status: 'ordered',
    sender: { ...address },
    recipient: { ...address },
    carrier: 'flash',
    parcel: { weightGrams: 500, widthCm: 10, lengthCm: 20, heightCm: 5 },
    trackingNumber: '',
    notes: '',
    createdAt: '2026-11-05T01:00:00.000Z',
    updatedAt: '2026-11-05T01:00:00.000Z',
  };
}
function request(body: unknown, endpoint = 'book', headers: Record<string, string> = {}): Request {
  return new Request(`${config.origin}/api/shipping/flash/${endpoint}`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3100',
      origin: config.origin,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const fakePdf = new TextEncoder().encode('%PDF-1.4\n% offline test fixture\n%%EOF');
function client(overrides: Partial<FlashClient> = {}): FlashClient {
  return {
    create: async (parameters) => ({
      trackingNumber: 'TH000TEST123A',
      outTradeNo: parameters.outTradeNo,
    }),
    label: async () => fakePdf,
    ...overrides,
  };
}
async function temporary(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'vetra-shipping-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('Flash signing follows documented SHA256 ordering and excludes blank/sign fields before URL encoding', () => {
  const fields = { mchId: 'AAXXXX', nonceStr: 'yyv6YJP436wCkdpNdghC', body: 'test' };
  // The published prose digest has inconsistent inputs. This vector follows its
  // formula and the official Python demo's UTF-8, ascending-key implementation.
  assert.equal(
    signFlashParameters(fields, 'dd807a8e18b40153888e5a9864e70080'),
    'AA075587187F40061528416620955EAB0974FD79BB5A85F6E249969865ED4EED',
  );
  assert.equal(
    signFlashParameters({ ...fields, blank: ' \t\n', sign: 'ignored' }, 'key'),
    signFlashParameters(fields, 'key'),
  );
  assert.notEqual(
    signFlashParameters({ body: 'Lisa&Ruby' }, 'key'),
    signFlashParameters({ body: 'Lisa%26Ruby' }, 'key'),
  );
});

test('Flash payload uses address/weight units and exact COD totals without enabling insurance', () => {
  const data = order();
  data.paymentMethod = 'cod';
  data.status = 'cod';
  const parameters = flashOrderParameters(data);
  assert.equal(parameters.weight, '500');
  assert.equal(parameters.dstCityName, data.recipient.district);
  assert.equal(parameters.dstDistrictName, data.recipient.subdistrict);
  assert.equal(parameters.codAmount, '30090');
  assert.equal(parameters.insured, '0');
  assert.equal(parameters.opdInsureEnabled, '0');
  assert.equal(parameters.expressCategory, '1');
  assert.equal(parameters.outTradeNo.length <= 64, true);
  assert.deepEqual(JSON.parse(parameters.subItemTypes), [{ itemName: 'สินค้า', itemQuantity: 2 }]);
  assert.throws(
    () => flashOrderParameters({ ...data, items: [{ ...data.items[0], quantity: 1000 }] }),
    /999/,
  );
  assert.throws(() => flashOrderParameters({ ...data, carrier: 'kex' }), /Flash Express only/);
  assert.throws(() => flashOrderParameters({ ...data, status: 'cancelled' }), /Complete the order/);
  assert.throws(
    () => flashOrderParameters({ ...data, sender: { ...address, name: 'a'.repeat(51) } }),
    /Shorten/,
  );
});

test('Flash client uses official training contract and verifies merchant/reference, no arbitrary hosts', async () => {
  const data = order();
  const parameters = flashOrderParameters(data);
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init! });
    return Response.json({
      code: 1,
      data: { pno: 'TH000TEST123A', mchId: config.merchantId, outTradeNo: parameters.outTradeNo },
    });
  };
  const result = await createFlashClient(config, fetcher).create(parameters);
  assert.equal(result.trackingNumber, 'TH000TEST123A');
  assert.equal(calls[0].url, 'https://open-api-tra.flashexpress.com/open/v3/orders');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.method, 'POST');
  const body = Object.fromEntries(new URLSearchParams(String(calls[0].init.body)));
  assert.equal(body.sign, signFlashParameters(body, config.apiKey));
  assert.equal(body.dstName, address.name);
  const mismatch: typeof fetch = async () =>
    Response.json({
      code: 1,
      data: { pno: 'TH000TEST123A', mchId: 'OTHER', outTradeNo: parameters.outTradeNo },
    });
  await assert.rejects(
    createFlashClient(config, mismatch).create(parameters),
    /could not be verified/,
  );
});

test('paid and refunded COD orders cannot book, while paid transfer orders do not collect COD', async (t) => {
  const directory = await temporary(t);
  let creates = 0;
  const options = {
    config,
    directory,
    client: client({
      create: async (parameters) => {
        creates++;
        assert.equal(parameters.codEnabled, '0');
        assert.equal('codAmount' in parameters, false);
        return { trackingNumber: 'TH000TEST123A', outTradeNo: parameters.outTradeNo };
      },
    }),
  };
  for (const paymentStatus of ['paid', 'refunded'] as const) {
    const response = await bookFlashShipment(
      request({ order: { ...order(), paymentMethod: 'cod', status: 'confirmed', paymentStatus } }),
      options,
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'FLASH_COD_PAYMENT_STATUS');
  }
  assert.equal(creates, 0);
  assert.deepEqual(await readdir(directory), []);
  const paidTransfer = await bookFlashShipment(
    request({ order: { ...order(), paymentMethod: 'transfer', status: 'paid' } }),
    options,
  );
  assert.equal(paidTransfer.status, 200);
  assert.equal(creates, 1);
});

test('Flash PDF retrieval preserves carrier bytes and rejects non-PDF responses', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(fakePdf);
  };
  const api = createFlashClient(config, fetcher);
  assert.deepEqual(await api.label('TH000TEST123A', '100x75'), fakePdf);
  assert.equal(
    calls[0],
    'https://open-api-tra.flashexpress.com/open/v1/orders/TH000TEST123A/small/pre_print',
  );
  const bad: typeof fetch = async () =>
    new Response('<html>login</html>', { headers: { 'content-type': 'application/pdf' } });
  await assert.rejects(
    createFlashClient(config, bad).label('TH000TEST123A', '100x180'),
    /has not returned its PDF/,
  );
});

test('local gateway is off by default and rejects cross-origin, missing origin and public/proxy hosts', () => {
  assert.equal(readShippingConfiguration({}).enabled, false);
  assert.equal(readShippingConfiguration({}).mode, 'training');
  assert.equal(
    readShippingConfiguration({
      VETRA_LOCAL_SHIPPING_ENABLED: 'true',
      VETRA_LOCAL_SHIPPING_ORIGIN: 'https://public.example',
    }).enabled,
    false,
  );
  assert.equal(
    readShippingConfiguration({ VETRA_LOCAL_SHIPPING_ENABLED: 'true', FLASH_API_MODE: 'prod-typo' })
      .enabled,
    false,
  );
  assert.doesNotThrow(() => requireLocalShippingRequest(request({}), config));
  assert.throws(
    () =>
      requireLocalShippingRequest(
        request({}, 'book', { origin: 'https://attacker.example' }),
        config,
      ),
    /local workspace/,
  );
  assert.throws(
    () => requireLocalShippingRequest(request({}, 'book', { host: 'public.example' }), config),
    /local workspace/,
  );
  assert.throws(
    () =>
      requireLocalShippingRequest(request({}, 'book', { 'sec-fetch-site': 'cross-site' }), config),
    /local workspace/,
  );
  assert.throws(
    () =>
      requireLocalShippingRequest(
        request({}, 'book', { 'x-forwarded-host': 'public.example' }),
        config,
      ),
    /local workspace/,
  );
  const withoutOrigin = request({});
  withoutOrigin.headers.delete('origin');
  assert.throws(() => requireLocalShippingRequest(withoutOrigin, config), /local workspace/);
});

test('capabilities return only safe flags and do not expose credentials', async () => {
  const response = shippingCapabilities(
    new Request(`${config.origin}/api/shipping/capabilities`, {
      headers: { host: '127.0.0.1:3100' },
    }),
    config,
  );
  assert.deepEqual(await response.json(), { enabled: true, configured: true, mode: 'training' });
  const external = shippingCapabilities(
    new Request('https://example.com/api/shipping/capabilities', {
      headers: { host: 'example.com' },
    }),
    config,
  );
  assert.deepEqual(await external.json(), { enabled: false, configured: false, mode: 'training' });
});

test('booking intent is durable before network, duplicate requests reuse one shipment after process restart', async (t) => {
  const directory = await temporary(t);
  let creates = 0;
  const api = client({
    create: async (parameters) => {
      creates++;
      const files = await readdir(directory, { recursive: true });
      const intentFile = files.find((file) => file.endsWith('intent.json'))!;
      const intent = JSON.parse(await readFile(path.join(directory, intentFile), 'utf8'));
      assert.equal(intent.orderId, order().id);
      assert.equal(intent.outTradeNo, parameters.outTradeNo);
      assert.equal('recipient' in intent, false);
      return { trackingNumber: 'TH000TEST123A', outTradeNo: parameters.outTradeNo };
    },
  });
  const result = await new LocalShippingLedger(config, api, { directory }).book(order());
  assert.equal(result.reused, false);
  const afterRestart = await new LocalShippingLedger(config, api, { directory }).book({
    ...order(),
    updatedAt: '2026-11-05T02:00:00.000Z',
    trackingNumber: result.shipment.trackingNumber,
    shipment: result.shipment,
  });
  assert.equal(afterRestart.reused, true);
  assert.deepEqual(afterRestart.shipment, result.shipment);
  assert.equal(creates, 1);
  await assert.rejects(
    new LocalShippingLedger(config, api, { directory }).book({
      ...order(),
      recipient: { ...address, address: 'changed' },
    }),
    /details changed/,
  );
  assert.equal(creates, 1);
});

test('simultaneous and uncertain requests never create a second parcel', async (t) => {
  const directory = await temporary(t);
  let creates = 0;
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = client({
    create: async () => {
      creates++;
      began();
      await wait;
      throw new Error('network timeout with private body');
    },
  });
  const first = new LocalShippingLedger(config, api, { directory }).book(order());
  await started;
  await assert.rejects(
    new LocalShippingLedger(config, api, { directory }).book(order()),
    /already attempted/,
  );
  release();
  await assert.rejects(first, /already attempted/);
  await assert.rejects(
    new LocalShippingLedger(config, api, { directory }).book(order()),
    /already attempted/,
  );
  assert.equal(creates, 1);
});

test('label failure retains successful booking; retry fetches PDF without rebooking', async (t) => {
  const directory = await temporary(t);
  let creates = 0;
  let labels = 0;
  const api = client({
    create: async (parameters) => {
      creates++;
      return { trackingNumber: 'TH000TEST123A', outTradeNo: parameters.outTradeNo };
    },
    label: async () => {
      if (++labels === 1) throw new ShippingError('FLASH_LABEL_UNAVAILABLE', 'Retry label.', 502);
      return fakePdf;
    },
  });
  const options = { config, client: api, directory };
  const booked = await bookFlashShipment(request({ order: order() }), options);
  assert.equal(booked.status, 200);
  const failedLabel = await downloadFlashLabel(
    request({ orderId: order().id, size: '100x180' }, 'label'),
    options,
  );
  assert.equal(failedLabel.status, 502);
  const label = await downloadFlashLabel(
    request({ orderId: order().id, size: '100x180' }, 'label'),
    options,
  );
  assert.equal(label.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(new Uint8Array(await label.arrayBuffer()), fakePdf);
  assert.equal(creates, 1);
  assert.equal(labels, 2);
});

test('incomplete or altered journal outcomes remain blocked without another carrier request', async (t) => {
  const directory = await temporary(t);
  let creates = 0;
  const api = client({
    create: async (parameters) => {
      creates++;
      return { trackingNumber: 'TH000TEST123A', outTradeNo: parameters.outTradeNo };
    },
  });
  const ledger = new LocalShippingLedger(config, api, { directory });
  await ledger.book(order());
  const outcomeFile = (await readdir(directory, { recursive: true })).find((file) =>
    file.endsWith('outcome.json'),
  )!;
  await writeFile(path.join(directory, outcomeFile), '{"status":"booked"}', 'utf8');
  await assert.rejects(ledger.book(order()), /already attempted/);
  await assert.rejects(ledger.label(order().id, '100x180'), /already attempted/);
  assert.equal(creates, 1);
});

test('gateway rejects malformed orders before carrier I/O and does not return sensitive errors', async (t) => {
  const directory = await temporary(t);
  let creates = 0;
  const options = {
    config,
    directory,
    client: client({
      create: async () => {
        creates++;
        throw new Error(config.apiKey);
      },
    }),
  };
  const invalid = await bookFlashShipment(request({ order: { id: 'bad' } }), options);
  assert.equal(invalid.status, 400);
  assert.equal(creates, 0);
  const attempted = await bookFlashShipment(request({ order: order() }), options);
  assert.equal(attempted.status, 409);
  assert.equal((await attempted.text()).includes(config.apiKey), false);
  const unknown = await downloadFlashLabel(
    request({ orderId: 'unknown-order', size: '100x180' }, 'label'),
    options,
  );
  assert.equal(unknown.status, 409);
});
