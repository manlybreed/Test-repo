import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.CEO_PASSWORD || "bluridge-ceo";
  const passwordHash = await bcrypt.hash(password, 10);

  // Finance owner (agreements + plant fees)
  await prisma.user.upsert({
    where: { email: "akshay@thebluridge.com" },
    create: {
      email: "akshay@thebluridge.com",
      name: "Akshay Royal",
      passwordHash,
      role: "CEO",
    },
    update: {
      passwordHash,
      name: "Akshay Royal",
    },
  });

  const email = process.env.CEO_EMAIL || "ceo@thebluridge.com";
  if (email.toLowerCase() !== "akshay@thebluridge.com") {
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: "BluRidge Ops",
        passwordHash,
        role: "CEO",
      },
      update: {
        passwordHash,
      },
    });
  }

  const existingCompany = await prisma.companyProfile.findFirst();
  if (!existingCompany) {
    await prisma.companyProfile.create({
      data: {
        legalName: "BLURIDGE CONSULTING PRIVATE LIMITED",
        tradeName: "The BluRidge",
        addressLine1: "Lower Ground Floor, D-1, Innov8 Ras Vilas",
        addressLine2: "Saket District Center, Saket",
        city: "New Delhi",
        state: "Delhi",
        stateCode: "07",
        pincode: "110017",
        gstin: "07AANCB9956E1Z7",
        pan: "AANCB9956E",
        email: "pmkusum@thebluridge.com",
        hsnDefault: "998313",
      },
    });
  } else {
    await prisma.companyProfile.update({
      where: { id: existingCompany.id },
      data: {
        legalName: "BLURIDGE CONSULTING PRIVATE LIMITED",
        addressLine1: "Lower Ground Floor, D-1, Innov8 Ras Vilas",
        addressLine2: "Saket District Center, Saket",
        city: "New Delhi",
        state: "Delhi",
        stateCode: "07",
        pincode: "110017",
        gstin: "07AANCB9956E1Z7",
      },
    });
  }

  await prisma.invoiceSequence.upsert({
    where: { id: "default" },
    create: { id: "default", lastNum: 8 },
    update: {},
  });

  const existingClient = await prisma.client.findFirst({
    where: { name: "BSS ECO SOLAR PRIVATE LIMITED" },
  });
  if (!existingClient) {
    await prisma.client.create({
      data: {
        name: "BSS ECO SOLAR PRIVATE LIMITED",
        addressLine1: "16 Arjun Nagar, Durgapura",
        city: "Jaipur",
        state: "Rajasthan",
        stateCode: "08",
        gstin: "08AANCB5904A1ZX",
        notes: "Reference buyer from INV-04",
      },
    });
  }

  const empCount = await prisma.employee.count();
  if (empCount === 0) {
    await prisma.employee.create({
      data: {
        name: "Sample Analyst",
        employeeCode: "BR-001",
        designation: "Analyst",
        department: "Advisory",
        phone: "9999999999",
        basic: 40000,
        hra: 16000,
        special: 8000,
        pf: 1800,
        professionalTax: 200,
        tdsPercent: 0,
      },
    });
  }

  console.log("Seed complete.");
  console.log(`Finance owner: akshay@thebluridge.com / ${password}`);
  console.log(`Ops login: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
