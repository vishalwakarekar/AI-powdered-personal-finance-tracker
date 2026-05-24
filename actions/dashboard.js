"use server";

import aj from "@/lib/arcjet";
import { db } from "@/lib/prisma";
import { request } from "@arcjet/next";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { checkUser } from "@/lib/checkUser"; // ✅ ADDED

const serializeTransaction = (obj) => {
  const serialized = { ...obj };
  if (obj.balance) {
    serialized.balance = Number(obj.balance);
  }
  if (obj.amount) {
    serialized.amount = Number(obj.amount);
  }
  return serialized;
};

// ✅ GET USER ACCOUNTS
export async function getUserAccounts() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // ✅ FIX: use checkUser
  const user = await checkUser();
  if (!user) throw new Error("User not found");

  try {
    const accounts = await db.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            transactions: true,
          },
        },
      },
    });

    return accounts.map(serializeTransaction);
  } catch (error) {
    console.error(error.message);
    return []; // ✅ prevent crash
  }
}

// ✅ CREATE ACCOUNT
export async function createAccount(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Arcjet
    const req = await request();
    const decision = await aj.protect(req, {
      userId,
      requested: 1,
    });

    if (decision.isDenied()) {
      throw new Error("Too many requests. Please try again later.");
    }

    // ✅ FIX: use checkUser
    const user = await checkUser();
    if (!user) throw new Error("User not found");

    const balanceFloat = parseFloat(data.balance);
    if (isNaN(balanceFloat)) {
      throw new Error("Invalid balance amount");
    }

    const existingAccounts = await db.account.findMany({
      where: { userId: user.id },
    });

    const shouldBeDefault =
      existingAccounts.length === 0 ? true : data.isDefault;

    if (shouldBeDefault) {
      await db.account.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const account = await db.account.create({
      data: {
        ...data,
        balance: balanceFloat,
        userId: user.id,
        isDefault: shouldBeDefault,
      },
    });

    const serializedAccount = serializeTransaction(account);

    revalidatePath("/dashboard");
    return { success: true, data: serializedAccount };
  } catch (error) {
    return { success: false, error: error.message }; // ✅ better handling
  }
}

// ✅ DASHBOARD DATA
export async function getDashboardData() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // ✅ FIX: use checkUser
  const user = await checkUser();
  if (!user) throw new Error("User not found");

  try {
    const transactions = await db.transaction.findMany({
      where: { userId: user.id },
      orderBy: { date: "desc" },
    });

    return transactions.map(serializeTransaction);
  } catch (error) {
    console.error(error.message);
    return []; // ✅ prevent crash
  }
}