import { Suspense } from 'react';
import Workspace from '@/components/workspace';
import { Skeleton } from '@/components/ui/skeleton';
export default function Home() { return <Suspense fallback={<div className="app-loading" role="status" aria-label="Đang mở TubeScope…"><Skeleton className="h-12 w-48" /><Skeleton className="h-96 w-full" /></div>}><Workspace /></Suspense>; }
