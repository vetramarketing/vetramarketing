import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/manrope';
import '@fontsource-variable/noto-sans-thai';
import './globals.css';
export const viewport: Viewport = {
  themeColor: '#141923',
  colorScheme: 'dark',
};
export const metadata: Metadata = {
  description: 'จัดการบริษัท ข้อมูลลูกค้า สินค้า และติดตามผลลัพธ์ของโพสต์ในพื้นที่เดียว',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
