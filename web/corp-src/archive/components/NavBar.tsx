import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MenuIcon from "@mui/icons-material/Menu";
import { useState } from "react";
import type { RepoOption, User } from "../../types";

type SiblingPage = { label: string; href: string; carryQuery?: boolean };

type Props = {
  authLoading?: boolean;
  user?: User | null;
  selectedRepo?: RepoOption | null;
  title?: string;
  siblingPages?: SiblingPage[];
};

function pageHref(page: SiblingPage): string {
  return page.carryQuery ? `${page.href}${window.location.search}` : page.href;
}

export default function NavBar({
  authLoading = false,
  user = null,
  selectedRepo = null,
  title,
  siblingPages = [],
}: Props) {
  const [copied, setCopied] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const menuOpen = !!anchorEl;
  const closeMenu = () => setAnchorEl(null);

  const copyLinkText = copied ? "Copied!" : "Copy link";

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        rowGap: 1,
        px: { xs: 2, sm: 4 },
        py: 1.75,
        background: "#ffffff",
        borderBottom: "1px solid #e2e8f0",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: "7px",
            background: "linear-gradient(135deg, #2563eb, #7c3aed)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.7rem",
            fontWeight: 800,
            color: "#fff",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          ZB
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a", letterSpacing: "-0.01em" }}>
          {title ?? document.title}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: 2 }}>
          {siblingPages.map((page) => (
            <Button
              key={page.href}
              size="small"
              component="a"
              href={pageHref(page)}
              sx={{
                fontSize: "0.72rem",
                textTransform: "none",
                color: "#64748b",
                fontFamily: "'IBM Plex Mono', monospace",
                "&:hover": { color: "#0f172a" },
              }}
            >
              {page.label}
            </Button>
          ))}
        </Box>

        {user && selectedRepo && !selectedRepo.isNew && (
          <Button
            size="small"
            variant="outlined"
            aria-label={copyLinkText}
            startIcon={copied ? <CheckIcon sx={{ fontSize: 12 }} /> : <ContentCopyIcon sx={{ fontSize: 12 }} />}
            onClick={() =>
              navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
            sx={{
              borderColor: copied ? "#bbf7d0" : "#e2e8f0",
              color: copied ? "#16a34a" : "#94a3b8",
              fontSize: "0.72rem",
              textTransform: "none",
              fontFamily: "'IBM Plex Mono', monospace",
              py: 0.5,
              transition: "color 0.15s, border-color 0.15s",
              "&:hover": { borderColor: "#cbd5e1", color: "#475569" },
            }}
          >
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {copyLinkText}
            </Box>
          </Button>
        )}

        {siblingPages.length > 0 && (
          <>
            <IconButton
              size="small"
              onClick={(e) => setAnchorEl(e.currentTarget)}
              sx={{ display: { xs: "inline-flex", md: "none" }, color: "#64748b" }}
            >
              <MenuIcon fontSize="small" />
            </IconButton>

            {isSmallScreen ? (
              <Dialog fullScreen open={menuOpen} onClose={closeMenu}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 2,
                    py: 1.75,
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <Typography
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      color: "#0f172a",
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    Pages
                  </Typography>
                  <IconButton onClick={closeMenu} aria-label="Close menu">
                    <CloseIcon />
                  </IconButton>
                </Box>
                {siblingPages.map((page) => (
                  <Box
                    key={page.href}
                    component="a"
                    href={pageHref(page)}
                    onClick={closeMenu}
                    sx={{
                      display: "block",
                      px: 3,
                      py: 2.5,
                      fontSize: "0.95rem",
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: "#0f172a",
                      textDecoration: "none",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {page.label}
                  </Box>
                ))}
              </Dialog>
            ) : (
              <Menu anchorEl={anchorEl} open={menuOpen} onClose={closeMenu}>
                {siblingPages.map((page) => (
                  <MenuItem
                    key={page.href}
                    component="a"
                    href={pageHref(page)}
                    onClick={closeMenu}
                    sx={{ fontSize: "0.78rem", fontFamily: "'IBM Plex Mono', monospace", color: "#475569" }}
                  >
                    {page.label}
                  </MenuItem>
                ))}
              </Menu>
            )}
          </>
        )}

        {authLoading && <CircularProgress size={16} sx={{ color: "#cbd5e1" }} />}
      </Box>
    </Box>
  );
}
