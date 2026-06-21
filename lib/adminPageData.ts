export type AdminDataState<T> = {
  data: T;
  error: string | null;
};

export async function loadAdminData<T>(
  label: string,
  loader: () => Promise<T>,
  fallback: T,
  errorMessage = "Admin data is temporarily unavailable. Check the server logs for details."
): Promise<AdminDataState<T>> {
  try {
    return {
      data: await loader(),
      error: null,
    };
  } catch (error) {
    console.error(`Admin data load failed: ${label}`, { error });
    return {
      data: fallback,
      error: errorMessage,
    };
  }
}
