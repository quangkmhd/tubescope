import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/geist';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = { title: 'TubeScope — Lưu trữ YouTube', description: 'Thu thập, lưu trữ và tra cứu metadata video YouTube trong kho cá nhân của bạn.' };
export const viewport: Viewport = { themeColor: '#F5F7FB' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}<Toaster theme="light" position="bottom-right" richColors closeButton /></body></html>;
}
