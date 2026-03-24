import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:3001",
});

export function isRequestCanceled(error: unknown) {
  return axios.isCancel(error) || (error instanceof Error && error.name === "CanceledError");
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    return (
      error.response?.data?.details ??
      error.response?.data?.error ??
      error.message ??
      fallback
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
