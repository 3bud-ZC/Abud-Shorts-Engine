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
  Typography,
  createTheme,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import AddIcon from "@mui/icons-material/Add";
import WorkIcon from "@mui/icons-material/Work";
import VideoIcon from "@mui/icons-material/VideoLibrary";
import BusinessIcon from "@mui/icons-material/Business";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import HubIcon from "@mui/icons-material/Hub";
import SettingsIcon from "@mui/icons-material/Settings";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import MenuIcon from "@mui/icons-material/Menu";
import SendIcon from "@mui/icons-material/Send";
import CircleIcon from "@mui/icons-material/Circle";

interface LayoutProps {
  children: React.ReactNode;
}

const drawerWidth = 264;

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#24545a" },
    secondary: { main: "#8a5a2b" },
    background: { default: "#f5f6f3", paper: "#ffffff" },
    text: { primary: "#1f2933", secondary: "#667085" },
    divider: "rgba(31, 41, 51, 0.1)",
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    button: { textTransform: "none", fontWeight: 700 },
    h4: { fontWeight: 850, letterSpacing: 0 },
    h5: { fontWeight: 800, letterSpacing: 0 },
    h6: { fontWeight: 800, letterSpacing: 0 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderColor: "rgba(31, 41, 51, 0.1)",
          boxShadow: "0 1px 2px rgba(31, 41, 51, 0.04)",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
  },
});

const navSections = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", path: "/", icon: <DashboardIcon /> }],
  },
  {
    label: "Production",
    items: [
      { label: "Create Video", path: "/create", icon: <AddIcon /> },
      { label: "Jobs", path: "/jobs", icon: <WorkIcon /> },
      { label: "Videos", path: "/videos", icon: <VideoIcon /> },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Brands", path: "/brands", icon: <BusinessIcon /> },
      { label: "Templates", path: "/templates", icon: <ViewModuleIcon /> },
    ],
  },
  {
    label: "Distribution",
    items: [{ label: "Publishing", path: "/publishing", icon: <SendIcon /> }],
  },
  {
    label: "Configuration",
    items: [
      { label: "Providers", path: "/providers", icon: <HubIcon /> },
      { label: "Settings", path: "/settings", icon: <SettingsIcon /> },
    ],
  },
  {
    label: "Operations",
    items: [{ label: "System", path: "/system", icon: <MonitorHeartIcon /> }],
  },
];

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/create": "Create Video",
  "/jobs": "Jobs",
  "/videos": "Videos",
  "/publishing": "Publishing",
  "/brands": "Brands",
  "/templates": "Templates",
  "/providers": "Providers",
  "/settings": "Settings",
  "/system": "System",
  "/setup": "Setup",
  "/login": "Sign in",
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const exactTitle = pageTitles[location.pathname];
    const dynamicTitle = location.pathname.startsWith("/jobs/")
      ? "Job Details"
      : location.pathname.startsWith("/video/")
        ? "Video Details"
        : exactTitle || "ABUD Shorts Engine";
    document.title = `${dynamicTitle} - ABUD Shorts Engine`;
  }, [location.pathname]);

  if (location.pathname === "/login") {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", bgcolor: "background.default", px: 2 }}>
          {children}
        </Box>
      </ThemeProvider>
    );
  }

  const drawer = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar sx={{ minHeight: 84, alignItems: "center", px: 2.5 }}>
        <Box onClick={() => navigate("/")} sx={{ cursor: "pointer", minWidth: 0 }}>
          <Typography variant="h6" lineHeight={1.08}>
            ABUD Shorts
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Control Plane V2
          </Typography>
        </Box>
      </Toolbar>
      <Stack spacing={1.25} sx={{ px: 1.5, pb: 2 }}>
        {navSections.map((section) => (
          <Box key={section.label}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", px: 1.5, py: 0.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}
            >
              {section.label}
            </Typography>
            <Stack spacing={0.35}>
              {section.items.map((item) => (
                <Button
                  key={item.path}
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
                    color: "text.secondary",
                    borderRadius: 1.5,
                    "& .MuiButton-startIcon": { color: "inherit", minWidth: 24 },
                    "&:hover": { bgcolor: "rgba(36, 84, 90, 0.06)", color: "text.primary" },
                    "&.active": {
                      bgcolor: "rgba(36, 84, 90, 0.12)",
                      color: "primary.main",
                      boxShadow: "inset 3px 0 0 #24545a",
                    },
                    "&:focus-visible": {
                      outline: "3px solid rgba(36,84,90,0.32)",
                      outlineOffset: 2,
                    },
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
      <Box sx={{ mt: "auto", px: 2, pb: 2 }}>
        <Typography variant="caption" color="text.secondary" display="block" fontWeight={700}>
          ABUD Shorts Engine · v2.1.0
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          V2.2 acceptance pending
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1 }}>
          <CircleIcon sx={{ fontSize: 9, color: "success.main" }} />
          <Typography variant="caption" color="text.secondary">
            Local stack running
          </Typography>
        </Stack>
        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => navigate("/setup")}
            sx={{ fontSize: "0.75rem", p: 0, minWidth: 0, color: "text.secondary" }}
          >
            Run Setup Wizard
          </Button>
        </Box>
      </Box>
    </Box>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
        <AppBar
          position="fixed"
          color="inherit"
          elevation={0}
          sx={{
            display: { md: "none" },
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Toolbar>
            <IconButton aria-label="Open navigation" edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6">ABUD Shorts</Typography>
          </Toolbar>
        </AppBar>

        <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            sx={{
              display: { xs: "block", md: "none" },
              "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box" },
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
                borderRight: "1px solid",
                borderColor: "divider",
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
            pt: { xs: 9, md: 4 },
            pb: 5,
            px: { xs: 2, sm: 3, lg: 4 },
            minWidth: 0,
          }}
        >
          <Box sx={{ width: "100%", maxWidth: 1600, mx: "auto" }}>{children}</Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default Layout;
