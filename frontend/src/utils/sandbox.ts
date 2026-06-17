import { checkSandboxIsActive, startSandbox } from "../api";

export interface SandboxOptions {
  onLoadingChange?: (loading: boolean, action: string | null) => void;
  showAlert?: boolean;
}

/**
 * Ensures the sandbox is active, starting it if necessary.
 * @param options Configuration options
 * @throws Error if sandbox check or start fails
 */
export async function ensureSandboxActive(
  options: SandboxOptions = {}
): Promise<void> {
  const { onLoadingChange, showAlert = true } = options;

  try {
    const isActive = await checkSandboxIsActive();
    if (!isActive) {
      onLoadingChange?.(true, "Starting sandbox");
      try {
        await startSandbox();
        // Don't set loading to false here - let the caller continue with their action
      } catch (error: any) {
        onLoadingChange?.(false, null);
        const errorMessage = error.message || "Unknown error";
        if (showAlert) {
          alert(
            `Failed to start sandbox: ${errorMessage}. The backend may be experiencing connection issues. Please try again in a moment.`
          );
        }
        throw new Error(`Failed to start sandbox: ${errorMessage}`);
      }
    }
  } catch (error: any) {
    onLoadingChange?.(false, null);
    const errorMessage = error.message || "Unknown error";
    if (showAlert) {
      alert(
        `Failed to check sandbox status: ${errorMessage}. The backend may be initializing. Please try again in a moment.`
      );
    }
    throw new Error(`Failed to check sandbox status: ${errorMessage}`);
  }
}
