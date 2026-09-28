import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { CardChrome, SetupStep } from "../../types";
import type { UseAccessPassCard } from "./useAccessPassCard";
import StepRow from "../StepRow";
import { logEvent } from "./telemetry";
import Card from "../../components/Card";
import CopyRow from "../../components/CopyRow";
import ViewLink from "../../components/ViewLink";
import { getEntraUsersUrl } from "../../logic/consoleUrls";
import { MONO as mono } from "../../config/styles";

const COMPLETED_USERS_KEY = "zeninstaller_corp_access_pass_completed_users";
const DELIVERY_CONFIRMED_USERS_KEY = "zeninstaller_corp_access_pass_delivery_confirmed_users";

function loadCompletedByUserId(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMPLETED_USERS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, !!v]));
  } catch {
    return {};
  }
}
function saveCompletedByUserId(value: Record<string, boolean>) {
  localStorage.setItem(COMPLETED_USERS_KEY, JSON.stringify(value));
}
function loadDeliveryConfirmedByUserId(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELIVERY_CONFIRMED_USERS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, !!v]));
  } catch {
    return {};
  }
}
function saveDeliveryConfirmedByUserId(value: Record<string, boolean>) {
  localStorage.setItem(DELIVERY_CONFIRMED_USERS_KEY, JSON.stringify(value));
}

type Props = {
  card: CardChrome;
  accessPass: UseAccessPassCard;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Create a Temporary Access Pass for a user managed by your signed-in account. This removes their existing sign-in
      methods, randomizes their password, and issues a one-hour access pass.
    </Typography>
  );
}

function Action() {
  return <ViewLink href={getEntraUsersUrl()} />;
}

/*
 * Creates a Microsoft Entra Temporary Access Pass for a user managed by the signed-in
 * account. Locked behind "azure_login" (see cardRequirements on useAccessPassCard), so
 * this body only ever renders once an Azure account + tenant are already confirmed —
 * unlike the standalone access-pass-src app, no separate sign-in/tenant UI lives here.
 */
export default function AccessPassCard({ card, accessPass }: Props) {
  const {
    steps,
    result,
    running,
    managerUsers,
    selectedManagerUserId,
    managerUsersLoading,
    managerUsersError,
    consentRequired,
    requestAccessPassConsent,
    reset,
    runForUser,
  } = accessPass;
  const disabled = card.locked;

  const PAGE_SIZE = 200;
  const [creatingUserId, setCreatingUserId] = useState<string | null>(null);
  const [confirmationUserId, setConfirmationUserId] = useState<string | null>(null);
  const [photoIdConfirmed, setPhotoIdConfirmed] = useState(false);
  const [passValuesByUserId, setPassValuesByUserId] = useState<Record<string, string>>({});
  const [deliveryConfirmedByUserId, setDeliveryConfirmedByUserId] =
    useState<Record<string, boolean>>(loadDeliveryConfirmedByUserId);
  const [completedByUserId, setCompletedByUserId] = useState<Record<string, boolean>>(loadCompletedByUserId);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

  const totalPages = useMemo(() => Math.max(1, Math.ceil(managerUsers.length / PAGE_SIZE)), [managerUsers.length]);
  const pagedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return managerUsers.slice(start, start + PAGE_SIZE);
  }, [currentPage, managerUsers]);
  const visiblePages = useMemo(() => {
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, currentPage - half);
    const end = Math.min(totalPages, start + windowSize - 1);
    if (end - start + 1 < windowSize) {
      start = Math.max(1, end - windowSize + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (!result?.targetUserId || !result.accessPassValue) return;
    setPassValuesByUserId((prev) => ({ ...prev, [result.targetUserId!]: result.accessPassValue }));
  }, [result]);

  useEffect(() => {
    saveCompletedByUserId(completedByUserId);
  }, [completedByUserId]);

  useEffect(() => {
    saveDeliveryConfirmedByUserId(deliveryConfirmedByUserId);
  }, [deliveryConfirmedByUserId]);

  const handleCreateForUser = async (userId: string) => {
    logEvent("accessPassCreateButtonClicked", {
      targetUserId: userId,
    });
    setConfirmationUserId(null);
    setPhotoIdConfirmed(false);
    setPassValuesByUserId((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setDeliveryConfirmedByUserId((prev) => ({ ...prev, [userId]: false }));
    setCompletedByUserId((prev) => ({ ...prev, [userId]: false }));
    setCreatingUserId(userId);
    try {
      const created = await runForUser(userId);
      if (created?.targetUserId && created.accessPassValue) {
        setPassValuesByUserId((prev) => ({ ...prev, [created.targetUserId!]: created.accessPassValue }));
      }
    } finally {
      setCreatingUserId(null);
    }
  };

  const goToPage = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) return;
    const target = Math.min(totalPages, Math.max(1, parsed));
    setCurrentPage(target);
  };

  // Determine if the current result corresponds to the selected Entra user, so we can show the access pass value only for that user.
  const showingSelectedUserPass = !!result && !!selectedManagerUserId && result.targetUserId === selectedManagerUserId;
  const hydratedSelectedUserSteps: SetupStep[] =
    showingSelectedUserPass && steps.length === 0
      ? [
          {
            id: "tap",
            label: "Create Temporary Access Pass",
            status: "done" as const,
            detail: "Temporary Access Pass created",
          },
        ]
      : steps;
  const hasFinishedOrErroredStep = hydratedSelectedUserSteps.some((s) => s.status === "done" || s.status === "error");
  const showingSelectedUserSteps =
    hydratedSelectedUserSteps.length > 0 && (running || showingSelectedUserPass || hasFinishedOrErroredStep);
  const selectedUserRunSucceeded =
    showingSelectedUserPass && !hydratedSelectedUserSteps.some((s) => s.status === "error");
  const shouldShowTryAgain = !running && showingSelectedUserSteps && !selectedUserRunSucceeded;
  const statusUserId = creatingUserId ?? selectedManagerUserId;

  return (
    <Card title="Access pass" action={<Action />} lockedIntro={<Intro />} {...card}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Intro />

        {/* Entra user selector */}
        <Box
          sx={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            px: 2,
            py: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: 1.25,
          }}
        >
          <Typography sx={{ fontSize: "0.78rem", color: "#0f172a", ...mono, fontWeight: 600 }}>
            Select Entra user
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexDirection: "column", width: "100%" }}>
            {managerUsersLoading && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={14} sx={{ color: "#2563eb" }} />
                <Typography sx={{ fontSize: "0.72rem", color: "#475569", ...mono }}>Loading users...</Typography>
              </Box>
            )}

            {!managerUsersLoading && managerUsers.length > 0 && (
              <TableContainer
                sx={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  background: "#ffffff",
                  width: "100%",
                  overflowX: "auto",
                }}
              >
                <Table size="small" sx={{ minWidth: 640 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...mono, fontSize: "0.68rem", color: "#334155", fontWeight: 700 }}>
                        Name
                      </TableCell>
                      <TableCell sx={{ ...mono, fontSize: "0.68rem", color: "#334155", fontWeight: 700 }}>
                        UPN
                      </TableCell>
                      <TableCell align="right" sx={{ ...mono, fontSize: "0.68rem", color: "#334155", fontWeight: 700 }}>
                        {" "}
                        Action{" "}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pagedUsers.map((user) => {
                      const isCurrentResult = result?.targetUserId === user.id;
                      const isCreatingThisUser = creatingUserId === user.id && running;
                      const savedPass = passValuesByUserId[user.id];
                      const isCompletedUser = !!completedByUserId[user.id];
                      const isDeliveryConfirmed = !!deliveryConfirmedByUserId[user.id];
                      const rowHighlightSx = isCompletedUser
                        ? { background: "#dbeafe" }
                        : isCurrentResult
                          ? { background: "#f0fdf4" }
                          : undefined;
                      const showingConfirmationForUser = confirmationUserId === user.id && !running;
                      const showingInlineStepsForUser = showingSelectedUserSteps && statusUserId === user.id;
                      return (
                        <Fragment key={user.id}>
                          <TableRow sx={rowHighlightSx}>
                            <TableCell
                              sx={{
                                ...mono,
                                fontSize: "0.76rem",
                                color: "#334155",
                                ...(savedPass || showingInlineStepsForUser || showingConfirmationForUser
                                  ? { borderBottom: "none" }
                                  : {}),
                              }}
                            >
                              {user.displayName}
                            </TableCell>
                            <TableCell
                              data-sensitive="true"
                              sx={{
                                ...mono,
                                fontSize: "0.72rem",
                                color: "#64748b",
                                ...(savedPass || showingInlineStepsForUser || showingConfirmationForUser
                                  ? { borderBottom: "none" }
                                  : {}),
                              }}
                            >
                              {user.userPrincipalName || "-"}
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={
                                savedPass || showingInlineStepsForUser || showingConfirmationForUser
                                  ? { borderBottom: "none" }
                                  : undefined
                              }
                            >
                              <Box sx={{ display: "flex", justifyContent: "flex-end", minHeight: 28 }}>
                                {!showingConfirmationForUser && (
                                  <Button
                                    size="small"
                                    variant="contained"
                                    onClick={() => {
                                      if (confirmationUserId !== user.id) {
                                        setConfirmationUserId(user.id);
                                        setPhotoIdConfirmed(false);
                                        return;
                                      }
                                      if (!photoIdConfirmed) return;
                                      void handleCreateForUser(user.id);
                                    }}
                                    disabled={disabled || running || (showingConfirmationForUser && !photoIdConfirmed)}
                                    sx={{
                                      textTransform: "none",
                                      ...mono,
                                      fontSize: "0.72rem",
                                      py: 0.35,
                                      px: 1.2,
                                      background: isCurrentResult ? "#16a34a" : "#2563eb",
                                      "&:hover": { background: isCurrentResult ? "#15803d" : "#1d4ed8" },
                                      "&.Mui-disabled": { background: "#e2e8f0", color: "#94a3b8" },
                                    }}
                                  >
                                    {isCreatingThisUser
                                      ? "Creating..."
                                      : savedPass
                                        ? "Create Again"
                                        : "Create Access Pass"}
                                  </Button>
                                )}
                              </Box>
                            </TableCell>
                          </TableRow>
                          {showingConfirmationForUser && (
                            <TableRow sx={rowHighlightSx ?? { background: "inherit" }}>
                              <TableCell
                                colSpan={3}
                                sx={{ py: 0.75, px: 1.5, borderBottom: savedPass ? "none" : undefined }}
                              >
                                <Box
                                  sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 0.75,
                                    borderLeft: "2px solid #fbbf24",
                                    pl: 1.25,
                                  }}
                                >
                                  <Typography sx={{ fontSize: "0.72rem", color: "#92400e", ...mono }}>
                                    If you continue, all existing access for this user will be deleted and a 1 hour
                                    temporary access pass will be created.
                                  </Typography>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                    <input
                                      type="checkbox"
                                      checked={photoIdConfirmed}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setPhotoIdConfirmed(checked);
                                        logEvent("accessPassPhotoIdCheckboxToggled", {
                                          targetUserId: user.id,
                                          checked,
                                        });
                                      }}
                                      style={{ margin: 0, width: 14, height: 14 }}
                                    />
                                    <Typography sx={{ fontSize: "0.7rem", color: "#92400e", ...mono }}>
                                      Confirm that you have viewed the photo ID and confirm it to be the person selected
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: "flex", justifyContent: "flex-end", pt: 0.35 }}>
                                    <Button
                                      size="small"
                                      variant="contained"
                                      onClick={() => {
                                        if (confirmationUserId !== user.id) {
                                          setConfirmationUserId(user.id);
                                          setPhotoIdConfirmed(false);
                                          return;
                                        }
                                        if (!photoIdConfirmed) return;
                                        void handleCreateForUser(user.id);
                                      }}
                                      disabled={disabled || running || !photoIdConfirmed}
                                      sx={{
                                        textTransform: "none",
                                        ...mono,
                                        fontSize: "0.72rem",
                                        py: 0.35,
                                        px: 1.2,
                                        background: isCurrentResult ? "#16a34a" : "#2563eb",
                                        "&:hover": { background: isCurrentResult ? "#15803d" : "#1d4ed8" },
                                        "&.Mui-disabled": { background: "#e2e8f0", color: "#94a3b8" },
                                      }}
                                    >
                                      {isCreatingThisUser
                                        ? "Creating..."
                                        : savedPass
                                          ? "Create Again"
                                          : "Create Access Pass"}
                                    </Button>
                                  </Box>
                                </Box>
                              </TableCell>
                            </TableRow>
                          )}
                          {showingInlineStepsForUser && (
                            <TableRow sx={rowHighlightSx ?? { background: "inherit" }}>
                              <TableCell
                                colSpan={3}
                                sx={{ py: 0.75, px: 1.5, borderBottom: savedPass ? "none" : undefined }}
                              >
                                <Box
                                  sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 0.25,
                                    borderLeft: "2px solid #e2e8f0",
                                    pl: 1.25,
                                  }}
                                >
                                  {hydratedSelectedUserSteps.map((s) => (
                                    <StepRow key={`${user.id}-${s.id}`} step={s} />
                                  ))}
                                  {running && (
                                    <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", ...mono, mt: 0.25 }}>
                                      Running...
                                    </Typography>
                                  )}
                                  {!running && (
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.25 }}>
                                      {consentRequired && (
                                        <Button
                                          size="small"
                                          variant="outlined"
                                          onClick={() => void requestAccessPassConsent()}
                                          sx={{
                                            textTransform: "none",
                                            ...mono,
                                            fontSize: "0.7rem",
                                            minWidth: 0,
                                            px: 1,
                                          }}
                                        >
                                          Grant consent
                                        </Button>
                                      )}
                                      {shouldShowTryAgain && (
                                        <Button
                                          size="small"
                                          onClick={reset}
                                          sx={{
                                            alignSelf: "flex-start",
                                            textTransform: "none",
                                            ...mono,
                                            fontSize: "0.72rem",
                                            color: "#64748b",
                                            px: 0.5,
                                            minWidth: 0,
                                            "&:hover": { color: "#2563eb" },
                                          }}
                                        >
                                          ↩ Try again
                                        </Button>
                                      )}
                                    </Box>
                                  )}
                                </Box>
                              </TableCell>
                            </TableRow>
                          )}
                          {savedPass && (
                            <TableRow sx={rowHighlightSx ?? { background: "inherit" }}>
                              <TableCell colSpan={3} sx={{ py: 0.5, px: 1.5 }}>
                                <CopyRow label="New Temporary Access Pass:" value={savedPass} masked />
                              </TableCell>
                            </TableRow>
                          )}
                          {savedPass && (
                            <TableRow sx={rowHighlightSx ?? { background: "inherit" }}>
                              <TableCell colSpan={3} sx={{ py: 0.75, px: 1.5 }}>
                                <Box
                                  sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 0.7,
                                    borderLeft: "2px solid #bfdbfe",
                                    pl: 1.25,
                                  }}
                                >
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                    <input
                                      type="checkbox"
                                      data-id="chkDeliveryConfirm"
                                      data-upn={user.userPrincipalName}
                                      checked={isDeliveryConfirmed}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setDeliveryConfirmedByUserId((prev) => ({ ...prev, [user.id]: checked }));
                                        logEvent("chkDeliveryConfirmClicked", {
                                          targetUpn: user.userPrincipalName,
                                          checked,
                                        });
                                        if (!checked) {
                                          setCompletedByUserId((prev) => ({ ...prev, [user.id]: false }));
                                        }
                                      }}
                                      style={{ margin: 0, width: 14, height: 14 }}
                                    />
                                    <Typography sx={{ fontSize: "0.7rem", color: "#1e3a8a", ...mono }}>
                                      Confirm that the person has successfully logged in and created their long term
                                      access pass on{" "}
                                      <a
                                        href="https://mysignins.microsoft.com/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        https://mysignins.microsoft.com/
                                      </a>
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                                    {isCompletedUser ? (
                                      <Typography
                                        sx={{
                                          ...mono,
                                          fontSize: "0.72rem",
                                          color: "#1d4ed8",
                                          fontWeight: 600,
                                          px: 1.2,
                                          py: 0.35,
                                        }}
                                      >
                                        Completed
                                      </Typography>
                                    ) : (
                                      <Button
                                        size="small"
                                        variant="contained"
                                        onClick={() => {
                                          if (!isDeliveryConfirmed) return;
                                          setCompletedByUserId((prev) => ({ ...prev, [user.id]: true }));
                                        }}
                                        disabled={!isDeliveryConfirmed}
                                        sx={{
                                          textTransform: "none",
                                          ...mono,
                                          fontSize: "0.72rem",
                                          py: 0.35,
                                          px: 1.2,
                                          background: "#2563eb",
                                          "&:hover": { background: "#1d4ed8" },
                                          "&.Mui-disabled": { background: "#e2e8f0", color: "#94a3b8" },
                                        }}
                                      >
                                        Mark Complete
                                      </Button>
                                    )}
                                  </Box>
                                </Box>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {!managerUsersLoading && managerUsers.length > PAGE_SIZE && (
              <Box
                sx={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  flexWrap: "wrap",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    sx={{ textTransform: "none", ...mono, minWidth: 0, px: 1 }}
                  >
                    Prev
                  </Button>
                  {visiblePages.map((page) => (
                    <Button
                      key={page}
                      size="small"
                      variant={page === currentPage ? "contained" : "outlined"}
                      onClick={() => setCurrentPage(page)}
                      sx={{ textTransform: "none", ...mono, minWidth: 32, px: 0.75 }}
                    >
                      {page}
                    </Button>
                  ))}
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    sx={{ textTransform: "none", ...mono, minWidth: 0, px: 1 }}
                  >
                    Next
                  </Button>
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <Typography sx={{ fontSize: "0.7rem", color: "#475569", ...mono }}>
                    Page {currentPage} of {totalPages}
                  </Typography>
                  <TextField
                    size="small"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && goToPage()}
                    placeholder="Page"
                    inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem", width: 48 } }}
                  />
                  <Button size="small" variant="outlined" onClick={goToPage} sx={{ textTransform: "none", ...mono }}>
                    Go
                  </Button>
                </Box>
              </Box>
            )}

            {!managerUsersLoading && managerUsers.length === 0 && !managerUsersError && (
              <Typography sx={{ fontSize: "0.72rem", color: "#475569", ...mono }}>
                No users found that are managed by your signed-in account.
              </Typography>
            )}

            {managerUsersError && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: "0.72rem", color: "#ef4444", ...mono }}>{managerUsersError}</Typography>
                {consentRequired && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void requestAccessPassConsent()}
                    sx={{ textTransform: "none", ...mono, fontSize: "0.7rem", minWidth: 0, px: 1 }}
                  >
                    Grant consent
                  </Button>
                )}
              </Box>
            )}
          </Box>
        </Box>
        {managerUsersError && (
          <Typography sx={{ fontSize: "0.72rem", color: "#ef4444", ...mono }}>{managerUsersError}</Typography>
        )}
      </Box>
    </Card>
  );
}
