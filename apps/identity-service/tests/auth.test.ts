/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildServer } from "../src/index";
import { FastifyInstance } from "fastify";

const {
  mockUserCreate,
  mockUserFindUnique,
  mockUserProfileCreate,
  mockUserProfileUpdate,
} = vi.hoisted(() => ({
  mockUserCreate: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserProfileCreate: vi.fn(),
  mockUserProfileUpdate: vi.fn(),
}));

vi.mock("@tech-vibe/database", () => {
  return {
    PrismaClient: class {
      user = {
        create: mockUserCreate,
        findUnique: mockUserFindUnique,
      };
      userProfile = {
        create: mockUserProfileCreate,
        update: mockUserProfileUpdate,
      };
    },
    TicketCategory: {
      general_inquiry: "general_inquiry",
      complaint: "complaint",
      bug_report: "bug_report",
      billing: "billing",
      feature_request: "feature_request",
    },
  };
});

import * as argon2 from "argon2";

describe("Auth Routes (Unit Tests)", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /api/v1/auth/register", () => {
    it("should successfully register a new user", async () => {
      mockUserCreate.mockResolvedValue({ id: 1n });
      mockUserProfileCreate.mockResolvedValue({});

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "Test User",
          email: "test@example.com",
          phone: "081234567890",
          password: "Password123!",
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.message).toBe("User registered successfully");
      expect(data.data.id).toBe("1");
    });

    it("should return 400 if email already exists", async () => {
      const prismaError = new Error("Unique constraint failed") as any;
      prismaError.code = "P2002";

      mockUserCreate.mockRejectedValue(prismaError);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "Test User",
          email: "test@example.com",
          phone: "081234567890",
          password: "Password123!",
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Email or phone already exists");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("should successfully login and set cookies", async () => {
      const mockHashedPassword = await argon2.hash("Password123!");

      mockUserFindUnique.mockResolvedValue({
        id: 1n,
        role: "customer",
        password_hash: mockHashedPassword,
      });

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "test@example.com",
          password: "Password123!",
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Login successful");

      const cookies = response.cookies;
      expect(cookies.some((c) => c.name === "accessToken")).toBe(true);
      expect(cookies.some((c) => c.name === "refreshToken")).toBe(true);
    });

    it("should return 401 for invalid credentials", async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "notfound@example.com",
          password: "Password123!",
        },
      });

      expect(response.statusCode).toBe(401);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Invalid credentials");
    });
  });
});
