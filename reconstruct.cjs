const fs = require('fs');
const modules = {
  'cart': { imports: ['AuthModule', 'InventoryModule'], c: ['CartController'], p: ['CartService', 'ReservationService'], e: ['CartService'] },
  'categories': { imports: ['AuthModule'], c: ['CategoriesController'], p: ['CategoriesService'], e: ['CategoriesService'] },
  'coupons': { imports: ['AuthModule'], c: ['CouponsController'], p: ['CouponsService'], e: ['CouponsService'] },
  'dashboard': { imports: ['AuthModule', 'InventoryModule'], c: ['DashboardController'], p: ['DashboardService'], e: ['DashboardService'] },
  'inventory': { imports: ['AuthModule'], c: ['InventoryController'], p: ['InventoryService'], e: ['InventoryService'] },
  'orders': { imports: ['AuthModule', 'CartModule', 'InventoryModule', 'CouponsModule'], c: ['OrdersController'], p: ['OrdersService'], e: ['OrdersService'] },
  'payments': { imports: ['AuthModule'], c: ['PaymentsController'], p: ['PaymentsService'], e: ['PaymentsService'] },
  'prisma': { imports: ['AuthModule'], c: [], p: ['PrismaService'], e: ['PrismaService'] },
  'products': { imports: ['AuthModule'], c: ['ProductsController'], p: ['ProductsService'], e: ['ProductsService'] },
  'users': { imports: [], c: [], p: ['UsersService'], e: ['UsersService'] },
  'webhooks': { imports: ['AuthModule', 'OrdersModule', 'InventoryModule'], c: ['WebhooksController'], p: ['WebhooksService'], e: ['WebhooksService'] },
};
for(const [name, meta] of Object.entries(modules)) {
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  let content = `import { Module } from '@nestjs/common';\n`;
  for (const imp of meta.imports) {
     if(imp === 'AuthModule') content += `import { AuthModule } from '../auth/auth.module.js';\n`;
     if(imp === 'InventoryModule') content += `import { InventoryModule } from '../inventory/inventory.module.js';\n`;
     if(imp === 'CartModule') content += `import { CartModule } from '../cart/cart.module.js';\n`;
     if(imp === 'CouponsModule') content += `import { CouponsModule } from '../coupons/coupons.module.js';\n`;
     if(imp === 'OrdersModule') content += `import { OrdersModule } from '../orders/orders.module.js';\n`;
  }
  for (const c of meta.c) {
     content += `import { ${c} } from './${name}.controller.js';\n`;
  }
  for (const p of meta.p) {
     if(p === 'ReservationService') {
         content += `import { ReservationService } from './reservation.service.js';\n`;
     } else {
         content += `import { ${p} } from './${name}.service.js';\n`;
     }
  }
  
  content += `\n@Module({\n`;
  if (meta.imports.length) content += `  imports: [${meta.imports.join(', ')}],\n`;
  if (meta.c.length) content += `  controllers: [${meta.c.join(', ')}],\n`;
  if (meta.p.length) content += `  providers: [${meta.p.join(', ')}],\n`;
  if (meta.e.length) content += `  exports: [${meta.e.join(', ')}],\n`;
  content += `})\nexport class ${Name}Module {}\n`;
  fs.writeFileSync(`src/${name}/${name}.module.ts`, content);
}
