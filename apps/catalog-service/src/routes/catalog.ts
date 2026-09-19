import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  // Public Endpoint: Search products
  fastify.get('/products', {
    schema: {
      querystring: Type.Object({
        q: Type.Optional(Type.String()),
        categoryId: Type.Optional(Type.Number()),
        minPrice: Type.Optional(Type.Number()),
        maxPrice: Type.Optional(Type.Number()),
        page: Type.Optional(Type.Number({ default: 1 })),
        limit: Type.Optional(Type.Number({ default: 10 })),
      })
    }
  }, async (request, reply) => {
    const { q, categoryId, minPrice, maxPrice, page, limit } = request.query as any;
    
    const where: any = { status: 'active' };
    
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { description: { contains: q } }
      ];
    }
    
    if (categoryId) {
      where.categoryId = categoryId;
    }
    
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    const skip = ((page || 1) - 1) * (limit || 10);
    const take = limit || 10;

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take,
        include: {
          images: { where: { isPrimary: true }, take: 1 }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return {
      data: products.map(p => ({
        ...p,
        id: p.id.toString(), // Convert BigInt to string for JSON serialization
        price: Number(p.price)
      })),
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    };
  });

  // Public Endpoint: Product detail
  fastify.get('/products/:id', {
    schema: {
      params: Type.Object({
        id: Type.String()
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    
    const product = await prisma.product.findUnique({
      where: { id: BigInt(id) },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        stock: true,
        category: true
      }
    });

    if (!product) {
      return fastify.httpErrors.notFound('Product not found');
    }

    const availableStock = product.stock ? (product.stock.stock - product.stock.reservedStock) : 0;

    return {
      data: {
        ...product,
        id: product.id.toString(),
        price: Number(product.price),
        stock: {
          available: availableStock
        }
      }
    };
  });

  // Admin Endpoint: Create product
  fastify.post('/admin/products', {
    preHandler: fastify.verifyAdmin,
    schema: {
      body: Type.Object({
        categoryId: Type.Number(),
        sku: Type.String(),
        name: Type.String(),
        slug: Type.String(),
        description: Type.Optional(Type.String()),
        price: Type.Number(),
        weightGrams: Type.Optional(Type.Number({ default: 1000 })),
        initialStock: Type.Optional(Type.Number({ default: 0 }))
      })
    }
  }, async (request, reply) => {
    const { categoryId, sku, name, slug, description, price, weightGrams, initialStock } = request.body as any;
    
    // Create product and stock in a transaction
    const product = await prisma.$transaction(async (tx) => {
      const createdProduct = await tx.product.create({
        data: {
          categoryId,
          sku,
          name,
          slug,
          description,
          price,
          weightGrams: weightGrams || 1000,
          status: 'draft', // By default draft
          stock: {
            create: {
              stock: initialStock || 0,
              reservedStock: 0
            }
          }
        },
        include: { stock: true }
      });
      return createdProduct;
    });

    return reply.code(201).send({
      data: {
        ...product,
        id: product.id.toString(),
        price: Number(product.price)
      }
    });
  });

  // Admin Endpoint: Update product
  fastify.put('/admin/products/:id', {
    preHandler: fastify.verifyAdmin,
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      body: Type.Object({
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        price: Type.Optional(Type.Number()),
        status: Type.Optional(Type.Union([
          Type.Literal('draft'),
          Type.Literal('active'),
          Type.Literal('archived')
        ]))
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const updateData = request.body as any;

    try {
      const updatedProduct = await prisma.product.update({
        where: { id: BigInt(id) },
        data: updateData
      });

      return {
        data: {
          ...updatedProduct,
          id: updatedProduct.id.toString(),
          price: Number(updatedProduct.price)
        }
      };
    } catch (error) {
      return fastify.httpErrors.notFound('Product not found or update failed');
    }
  });

  // Admin Endpoint: Restock product
  fastify.patch('/admin/products/:id/stock', {
    preHandler: fastify.verifyAdmin,
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      body: Type.Object({
        quantity: Type.Number({ minimum: 1 })
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { quantity } = request.body as any;

    try {
      const updatedStock = await prisma.productStock.update({
        where: { productId: BigInt(id) },
        data: {
          stock: { increment: quantity }
        }
      });

      return {
        data: {
          productId: updatedStock.productId.toString(),
          stock: updatedStock.stock,
          reservedStock: updatedStock.reservedStock
        }
      };
    } catch (error) {
      return fastify.httpErrors.notFound('Product stock not found');
    }
  });
};

export default catalogRoutes;
