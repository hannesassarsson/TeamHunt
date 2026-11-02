import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./lib/auth";
import { OrgProvider, useOrg } from "./lib/org";
import { isConfigured } from "./lib/supabase";
import { AppShell } from "./components/AppShell";
import { PageLoader } from "./components/ui/misc";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./pages/Login";
import { OnboardingPage } from "./pages/Onboarding";
import { AcceptInvitePage } from "./pages/AcceptInvite";
import { NotConfigured } from "./pages/NotConfigured";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const MapPage = lazy(() => import("./pages/MapPage"));
const Library = lazy(() => import("./pages/Library"));
const Cameras = lazy(() => import("./pages/Cameras"));
const CameraDetail = lazy(() => import("./pages/CameraDetail"));
const Observations = lazy(() => import("./pages/Observations"));
const Journal = lazy(() => import("./pages/Journal"));
const SessionDetail = lazy(() => import("./pages/SessionDetail"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Weather = lazy(() => import("./pages/Weather"));
const Team = lazy(() => import("./pages/Team"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Settings = lazy(() => import("./pages/Settings"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => n < 2 && !(e instanceof Error && /permission|not found/i.test(e.message)), refetchOnWindowFocus: false },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function RequireOrg({ children }: { children: ReactNode }) {
  const { org, loading } = useOrg();
  if (loading) return <PageLoader />;
  if (!org) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <OrgProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/invite/:token" element={<RequireAuth><AcceptInvitePage /></RequireAuth>} />
                  <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
                  <Route element={<RequireAuth><RequireOrg><AppShell /></RequireOrg></RequireAuth>}>
                    <Route index element={<Dashboard />} />
                    <Route path="map" element={<MapPage />} />
                    <Route path="library" element={<Library />} />
                    <Route path="cameras" element={<Cameras />} />
                    <Route path="cameras/:id" element={<CameraDetail />} />
                    <Route path="observations" element={<Observations />} />
                    <Route path="journal" element={<Journal />} />
                    <Route path="journal/:id" element={<SessionDetail />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="weather" element={<Weather />} />
                    <Route path="team" element={<Team />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </OrgProvider>
        </BrowserRouter>
      </AuthProvider>
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
