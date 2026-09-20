/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  errors?: any;
}
