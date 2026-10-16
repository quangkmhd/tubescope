import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/geist';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = { title: 'TubeScope — YouTube Library', description: 'Collect, save, and browse YouTube video metadata in your personal library.' };
export const viewport: Viewport = { themeColor: '#F5F7FB' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<Toaster theme="light" position="bottom-right" richColors closeButton /></body></html>;
}
