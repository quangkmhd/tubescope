import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/geist';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = { title: 'TubeScope — Kho nghiên cứu YouTube', description: 'Khám phá, lưu và nghiên cứu metadata YouTube trong không gian cá nhân của bạn.' };
export const viewport: Viewport = { themeColor: '#F5F7FB' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}<Toaster theme="light" position="bottom-right" richColors closeButton /></body></html>;
}
