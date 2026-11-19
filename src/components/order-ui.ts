import type { CarrierId, Order } from '@/lib/orders';
import type { Translate } from '@/lib/types';

export const carrierOptions = [
  { value: 'flash', en: 'Flash Express', th: 'Flash Express' },
  { value: 'thailand-post', en: 'Thailand Post', th: 'ไปรษณีย์ไทย' },
  { value: 'kex', en: 'KEX Express', th: 'KEX Express' },
  { value: 'jnt', en: 'J&T Express', th: 'J&T Express' },
  { value: 'dhl', en: 'DHL', th: 'DHL' },
  { value: 'other', en: 'Other carrier', th: 'ขนส่งอื่น' },
] as const satisfies readonly { value: CarrierId; en: string; th: string }[];

export const statusOptions = [
  { value: 'ordered', en: 'Ordered', th: 'สั่งซื้อแล้ว' },
  { value: 'cod', en: 'COD', th: 'เก็บเงินปลายทาง' },
  { value: 'paid', en: 'Paid', th: 'ชำระแล้ว' },
  { value: 'shipped', en: 'Shipped', th: 'จัดส่งแล้ว' },
  { value: 'completed', en: 'Completed', th: 'สำเร็จ' },
  { value: 'cancelled', en: 'Cancelled', th: 'ยกเลิก' },
] as const satisfies readonly { value: Order['status']; en: string; th: string }[];

export const paymentOptions = [
  { value: 'transfer', en: 'Bank transfer', th: 'โอนเงิน' },
  { value: 'cash', en: 'Cash', th: 'เงินสด' },
  { value: 'cod', en: 'Cash on delivery', th: 'เก็บเงินปลายทาง' },
] as const;

export function orderErrorMessage(cause: unknown, t: Translate): string {
  const message = cause instanceof Error ? cause.message : '';
  const translations: Record<string, string> = {
    'Discount cannot exceed the items subtotal.': 'ส่วนลดต้องไม่เกินยอดรวมค่าสินค้า',
    'Add at least one order item.': 'เพิ่มสินค้าอย่างน้อย 1 รายการ',
    'Recipient phone is invalid.': 'เบอร์โทรศัพท์ผู้รับไม่ถูกต้อง',
    'Recipient postal code must contain 5 digits.': 'รหัสไปรษณีย์ผู้รับต้องมี 5 หลัก',
    'This order changed or was removed. Reopen it before saving.':
      'ออเดอร์นี้ถูกเปลี่ยนหรือลบจากที่อื่น โปรดเปิดใหม่ก่อนบันทึก',
    'This order changed or was removed. Reopen it before deleting.':
      'ออเดอร์นี้ถูกเปลี่ยนหรือลบจากที่อื่น โปรดเปิดใหม่ก่อนลบ',
    'Choose an active customer belonging to this company.':
      'เลือกลูกค้าที่ยังใช้งานอยู่และเป็นลูกค้าของบริษัทนี้',
    'Choose active products belonging to this company.':
      'เลือกสินค้าที่ยังใช้งานอยู่และเป็นสินค้าของบริษัทนี้',
  };
  if (translations[message]) return t(message, translations[message]);
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  if (code === 'shipment-locked')
    return t(
      message,
      'ข้อมูลนี้ถูกล็อกให้ตรงกับใบปะหน้าหรือพัสดุที่จองไว้ โปรดตรวจสอบการจองก่อนแก้ไข',
    );
  return (
    message ||
    t('The change could not be completed. Please try again.', 'ดำเนินการไม่สำเร็จ โปรดลองอีกครั้ง')
  );
}
