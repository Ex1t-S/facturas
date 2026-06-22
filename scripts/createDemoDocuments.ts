import { prisma } from '../src/db.js';
import { createDemoDocuments } from '../src/services/demoDocuments.js';

async function main() {
  await createDemoDocuments();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
