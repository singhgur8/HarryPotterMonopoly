import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "@/pages/Landing";
import Room from "@/pages/Room";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";

function RoomWrapper({ params }: { params: { code: string } }) {
  return <Room roomCode={params.code.toUpperCase()} />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/room/:code">{(params) => <RoomWrapper params={params} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ThemeInitializer() {
  useEffect(() => {
    // The table is designed for a light background
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  }, []);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeInitializer />
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
