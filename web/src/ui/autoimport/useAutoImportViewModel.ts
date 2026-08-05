import { useCallback, useReducer } from "react";
import { prefs } from "../../data/AutoImportPreferences";
import { schedulePolling, cancelPolling } from "../../service/AutoImportService";

interface ConnectorState {
  enabled: boolean;
  email: string | null;
  isAuthenticated: boolean;
  hasConsent: boolean;
}

interface State {
  gmail: ConnectorState;
  outlook: ConnectorState;
  desktopFolderName: string | null;
}

type Action =
  | { type: "reload" }
  | { type: "setDesktopFolder"; name: string | null };

function load(): State {
  return {
    gmail: {
      enabled: prefs.gmailEnabled,
      email: prefs.gmailEmail,
      isAuthenticated: !!prefs.gmailAccessToken,
      hasConsent: prefs.gmailConsentGiven,
    },
    outlook: {
      enabled: prefs.outlookEnabled,
      email: prefs.outlookEmail,
      isAuthenticated: !!prefs.outlookAccessToken,
      hasConsent: prefs.outlookConsentGiven,
    },
    desktopFolderName: prefs.desktopFolderName,
  };
}

function reducer(state: State, action: Action): State {
  if (action.type === "reload") return load();
  if (action.type === "setDesktopFolder") return { ...state, desktopFolderName: action.name };
  return state;
}

function reschedule() {
  const anyEnabled = prefs.gmailEnabled || prefs.outlookEnabled || !!prefs.desktopFolderName;
  if (anyEnabled) schedulePolling();
  else cancelPolling();
}

export function useAutoImportViewModel() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  const reload = useCallback(() => dispatch({ type: "reload" }), []);

  const toggleGmail = useCallback((enabled: boolean) => {
    prefs.gmailEnabled = enabled;
    reschedule();
    reload();
  }, [reload]);

  const toggleOutlook = useCallback((enabled: boolean) => {
    prefs.outlookEnabled = enabled;
    reschedule();
    reload();
  }, [reload]);

  const acceptGmailConsent = useCallback(() => {
    prefs.gmailConsentGiven = true;
    reload();
  }, [reload]);

  const acceptOutlookConsent = useCallback(() => {
    prefs.outlookConsentGiven = true;
    reload();
  }, [reload]);

  const onGmailSignedIn = useCallback((email: string, token: string) => {
    prefs.gmailEmail = email;
    prefs.gmailAccessToken = token;
    prefs.gmailEnabled = true;
    reschedule();
    reload();
  }, [reload]);

  const onOutlookSignedIn = useCallback((email: string, token: string) => {
    prefs.outlookEmail = email;
    prefs.outlookAccessToken = token;
    prefs.outlookEnabled = true;
    reschedule();
    reload();
  }, [reload]);

  const revokeGmail = useCallback(() => {
    prefs.revokeGmail();
    reschedule();
    reload();
  }, [reload]);

  const revokeOutlook = useCallback(() => {
    prefs.revokeOutlook();
    reschedule();
    reload();
  }, [reload]);

  const setDesktopFolder = useCallback((name: string | null) => {
    prefs.desktopFolderName = name;
    dispatch({ type: "setDesktopFolder", name });
    reschedule();
  }, []);

  return {
    state,
    toggleGmail,
    toggleOutlook,
    acceptGmailConsent,
    acceptOutlookConsent,
    onGmailSignedIn,
    onOutlookSignedIn,
    revokeGmail,
    revokeOutlook,
    setDesktopFolder,
  };
}
