import React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  CssBaseline,
  Drawer,
  IconButton,
  Stack,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/SpaceDashboardOutlined";
import AddIcon from "@mui/icons-material/AddCircleOutline";
import WorkIcon from "@mui/icons-material/MovieFilterOutlined";
import VideoIcon from "@mui/icons-material/VideoLibraryOutlined";
import BusinessIcon from "@mui/icons-material/StorefrontOutlined";
import ViewModuleIcon from "@mui/icons-material/DashboardCustomizeOutlined";
import HubIcon from "@mui/icons-material/ExtensionOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import MonitorHeartIcon from "@mui/icons-material/FavoriteBorderOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import SendIcon from "@mui/icons-material/SendOutlined";
import CircleIcon from "@mui/icons-material/Circle";
import PermMediaIcon from "@mui/icons-material/PermMediaOutlined";

import { abudTheme } from "../theme/abudTheme";
import { AbudWordmark } from "./AbudMark";

interface LayoutProps {
  children: React.ReactNode;
}

const drawerWidth = 268;

/**
 * Client-facing navigation.
 *
 * Grouped by what the customer is trying to do, not by how the engine is built.
 * n8n, PostgreSQL, the render worker and the internal service token are
 * deliberately absent: they are implementation, and the customer never has to
 * know they exist.
 */
const navSections: Array<{
  label: string;
  items: Array<{ label: string; path: string; icon: React.ReactNode }>;
}> = [
  {
    label: "",
    items: [{ label: "Dashboard", path: "/", icon: <DashboardIcon /> }],
  },
  {
    label: "Create",
    items: [
      { label: "Create Video", path: "/create", icon: <AddIcon /> },
      { label: "Productions", path: "/jobs", icon: <WorkIcon /> },
      { label: "Video Library", path: "/videos", icon: <VideoIcon /> },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Brands", path: "/brands", icon: <BusinessIcon /> },
      { label: "Templates", path: "/templates", icon: <ViewModuleIcon /> },
      { label: "Media", path: "/media", icon: <PermMediaIcon /> },
    ],
  },
  {
    label: "Distribute",
    items: [{ label: "Publishing", path: "/publishing", icon: <SendIcon /> }],
  },
  {
    label: "Configure",
    items: [
      { label: "Integrations", path: "/integrations", icon: <HubIcon /> },
      { label: "Settings", path: "/settings", icon: <SettingsIcon /> },
    ],
  },
  {
    label: "System",
    items: [{ label: "System Health", path: "/system", icon: <MonitorHeartIcon /> }],
  },
];

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/create": "Create Video",
  "/jobs": "Productions",
  "/videos": "Video Library",
  "/media": "Media",
  "/publishing": "Publishing",
  "/brands": "Brands",
  "/templates": "Templates",
  "/integrations": "Integrations",
  "/providers": "Integrations",
  "/settings": "Settings",
  "/system": "System Health",
  "/setup": "Setup",
  "/login": "Sign in",
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const t = abudTheme.abud;

  React.useEffect(() => {
    const exactTitle = pageTitles[location.pathname];
    const dynamicTitle = location.pathname.startsWith("/jobs/")
      ? "Production Details"
      : location.pathname.startsWith("/video/")
        ? "Video Details"
        : exactTitle || "ABUD Shorts";
    document.title = `${dynamicTitle} · ABUD Shorts`;
  }, [location.pathname]);

  // Login and Setup are full-bleed: no shell, no navigation to get lost in.
  if (location.pathname === "/login") {
    return (
      <ThemeProvider theme={abudTheme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", bgcolor: "background.default", px: 2 }}>{children}</Box>
      </ThemeProvider>
    );
  }

  const drawer = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: t.backgroundAlt,
      }}
    >
      <Toolbar sx={{ minHeight: 88, alignItems: "center", px: 2.5 }}>
        <AbudWordmark onClick={() => navigate("/")} />
      </Toolbar>

      <Box component="nav" aria-label="Main navigation" sx={{ px: 1.5, pb: 2, overflowY: "auto" }}>
        <Stack spacing={1.5}>
          {navSections.map((section, sectionIndex) => (
            <Box key={section.label || `section-${sectionIndex}`}>
              {section.label && (
                <Typography
                  variant="caption"
                  component="div"
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.10em",
                    fontSize: "0.68rem",
                    color: t.muted,
                  }}
                >
                  {section.label}
                </Typography>
              )}
              <Stack spacing={0.25} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {section.items.map((item) => (
                  <li key={item.path}>
                    <Button
                      component={NavLink}
                      to={item.path}
                      end={item.path === "/" ? true : undefined}
                      startIcon={item.icon}
                      fullWidth
                      onClick={() => setMobileOpen(false)}
                      sx={{
                        justifyContent: "flex-start",
                        minHeight: 42,
                        px: 1.5,
                        fontWeight: 500,
                        color: t.textSecondary,
                        borderRadius: 2,
                        "& .MuiButton-startIcon": { color: "inherit", minWidth: 24 },
                        "&:hover": { bgcolor: t.surfaceHover, color: t.textPrimary },
                        "&.active": {
                          bgcolor: t.primaryMuted,
                          color: t.textPrimary,
                          fontWeight: 600,
                          boxShadow: `inset 2px 0 0 ${t.primary}`,
                        },
                      }}
                    >
                      {item.label}
                    </Button>
                  </li>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box sx={{ mt: "auto", px: 2.5, pb: 2.5, pt: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
          <CircleIcon sx={{ fontSize: 8, color: t.success }} aria-hidden="true" />
          <Typography variant="caption" sx={{ color: t.textSecondary }}>
            All services running
          </Typography>
        </Stack>
        <Tooltip title="Re-run the guided setup at any time">
          <Button
            size="small"
            variant="text"
            onClick={() => navigate("/setup")}
            sx={{ fontSize: "0.75rem", px: 0, minWidth: 0, minHeight: 28, color: t.muted }}
          >
            Setup guide
          </Button>
        </Tooltip>
      </Box>
    </Box>
  );

  return (
    <ThemeProvider theme={abudTheme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: t.background }}>
        <AppBar
          position="fixed"
          elevation={0}
          sx={{
            display: { md: "none" },
            bgcolor: t.backgroundAlt,
            borderBottom: `1px solid ${t.border}`,
            backgroundImage: "none",
          }}
        >
          <Toolbar>
            <IconButton
              aria-label="Open navigation menu"
              edge="start"
              onClick={() => setMobileOpen(true)}
              sx={{ mr: 1.5, color: t.textPrimary }}
            >
              <MenuIcon />
            </IconButton>
            <AbudWordmark size={26} subtitle={null} onClick={() => navigate("/")} />
          </Toolbar>
        </AppBar>

        <Box component="div" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: "block", md: "none" },
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                boxSizing: "border-box",
                bgcolor: t.backgroundAlt,
                borderRight: `1px solid ${t.border}`,
              },
            }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: "none", md: "block" },
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                boxSizing: "border-box",
                bgcolor: t.backgroundAlt,
                borderRight: `1px solid ${t.border}`,
              },
            }}
          >
            {drawer}
          </Drawer>
        </Box>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            width: { xs: "100%", md: `calc(100% - ${drawerWidth}px)` },
            pt: { xs: 10, md: 4 },
            pb: 6,
            px: { xs: 2, sm: 3, lg: 4 },
            minWidth: 0,
            // A subtle violet wash at the top; nowhere near body text.
            backgroundImage: `radial-gradient(1200px 380px at 22% -12%, ${t.primaryMuted} 0%, transparent 70%)`,
          }}
        >
          <Box sx={{ width: "100%", maxWidth: 1560, mx: "auto", minWidth: 0 }}>{children}</Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default Layout;
