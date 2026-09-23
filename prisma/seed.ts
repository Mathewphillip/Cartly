import { PrismaClient, Role, MovementReason, DiscountType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create Admin User
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@cartly.test' },
    update: {},
    create: {
      email: 'admin@cartly.test',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
    },
  });
  console.log(`Created admin user: ${admin.email}`);

  // 2. Create Customer User
  const customerPasswordHash = await bcrypt.hash('customer123', 10);
  const customer = await prisma.user.upsert({
    where: { email: 'customer@cartly.test' },
    update: {},
    create: {
      email: 'customer@cartly.test',
      passwordHash: customerPasswordHash,
      role: Role.CUSTOMER,
    },
  });
  console.log(`Created customer user: ${customer.email}`);

  // 3. Create Categories
  const electronicsCategory = await prisma.category.upsert({
    where: { slug: 'electronics' },
    update: {},
    create: {
      name: 'Electronics',
      slug: 'electronics',
      description: 'Gadgets and electronic devices',
    },
  });

  const clothingCategory = await prisma.category.upsert({
    where: { slug: 'clothing' },
    update: {},
    create: {
      name: 'Clothing',
      slug: 'clothing',
      description: 'Apparel and fashion items',
    },
  });
  console.log(`Created categories`);

  // 4. Create Products and Initial Stock
  const laptop = await prisma.product.upsert({
    where: { sku: 'TECH-LAPTOP-01' },
    update: {},
    create: {
      name: 'Pro Laptop 15"',
      slug: 'pro-laptop-15',
      description: 'High performance laptop for professionals',
      sku: 'TECH-LAPTOP-01',
      price: 1299.99,
      categoryId: electronicsCategory.id,
    },
  });

  // Check if stock exists, if not, create INITIAL_STOCK movement
  const laptopStock = await prisma.stockMovement.findFirst({
    where: { productId: laptop.id, reason: MovementReason.INITIAL_STOCK },
  });
  if (!laptopStock) {
    await prisma.stockMovement.create({
      data: {
        productId: laptop.id,
        quantityChange: 50,
        reason: MovementReason.INITIAL_STOCK,
        reference: 'Initial Seed',
      },
    });
  }

  const tshirt = await prisma.product.upsert({
    where: { sku: 'APP-TSHIRT-BLK' },
    update: {},
    create: {
      name: 'Basic Black T-Shirt',
      slug: 'basic-black-tshirt',
      description: '100% cotton basic black t-shirt',
      sku: 'APP-TSHIRT-BLK',
      price: 19.99,
      categoryId: clothingCategory.id,
    },
  });

  const tshirtStock = await prisma.stockMovement.findFirst({
    where: { productId: tshirt.id, reason: MovementReason.INITIAL_STOCK },
  });
  if (!tshirtStock) {
    await prisma.stockMovement.create({
      data: {
        productId: tshirt.id,
        quantityChange: 200,
        reason: MovementReason.INITIAL_STOCK,
        reference: 'Initial Seed',
      },
    });
  }
  console.log(`Created products and initial stock`);

  // 5. Create a Coupon
  const welcomeCoupon = await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      discountType: DiscountType.PERCENTAGE,
      value: 10.0,
      minOrderValue: 50.0,
      usageLimit: 100,
      expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });
  console.log(`Created coupon: ${welcomeCoupon.code}`);

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
