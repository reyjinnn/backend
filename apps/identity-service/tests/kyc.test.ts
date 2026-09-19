import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildServer } from "../src/index";
import { FastifyInstance } from "fastify";

const { mockUserProfileUpdate } = vi.hoisted(() => ({
  mockUserProfileUpdate: vi.fn(),
}));

vi.mock("@tech-vibe/database", () => {
  return {
    PrismaClient: class {
      userProfile = {
        update: mockUserProfileUpdate,
      };
    },
  };
});

describe("KYC Routes (Unit Tests)", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
    await server.ready();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /api/v1/kyc/submit", () => {
    it("should successfully submit KYC documents", async () => {
      mockUserProfileUpdate.mockResolvedValue({});

      const token = server.jwt.sign({ id: "1", role: "customer" });

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/kyc/submit",
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          nik: "1234567890123456",
          address: "Jl. Merdeka No 1",
          ktpImageUr: "http://example.com/ktp.jpg",
          selfieImageUr: "http://example.com/selfie.jpg",
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.message).toBe("KYC documents submitted successfully");
    });

    it("should return 401 if unauthorized", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/kyc/submit",
        payload: {
          nik: "1234567890123456",
          address: "Jl. Merdeka No 1",
          ktpImageUr: "http://example.com/ktp.jpg",
          selfieImageUr: "http://example.com/selfie.jpg",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 500 if database update fails", async () => {
      mockUserProfileUpdate.mockRejectedValue(new Error("DB Error"));

      const token = server.jwt.sign({ id: "1", role: "customer" });

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/kyc/submit",
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          nik: "1234567890123456",
          address: "Jl. Merdeka No 1",
          ktpImageUr: "http://example.com/ktp.jpg",
          selfieImageUr: "http://example.com/selfie.jpg",
        },
      });

      expect(response.statusCode).toBe(500);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Internal server error");
    });
  });
});
