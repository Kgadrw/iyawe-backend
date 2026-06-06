import bcrypt from 'bcryptjs'
import { collections } from './db'
import { ObjectId } from 'mongodb'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export interface User {
  _id?: ObjectId
  email: string
  passwordHash: string
  name: string
  phone?: string
  role: 'USER' | 'INSTITUTION' | 'OFFICER' | 'ADMIN'
  createdAt: Date
  updatedAt: Date
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  phone?: string,
  role: 'USER' | 'INSTITUTION' | 'OFFICER' | 'ADMIN' = 'USER'
): Promise<User> {
  const passwordHash = await hashPassword(password)
  const now = new Date()
  
  const user: User = {
    email,
    passwordHash,
    name,
    phone,
    role,
    createdAt: now,
    updatedAt: now,
  }

  const result = await collections.users().insertOne(user)
  user._id = result.insertedId
  return user
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return collections.users().findOne({ email }) as Promise<User | null>
}

export async function getUserById(id: string): Promise<User | null> {
  return collections.users().findOne({ _id: new ObjectId(id) }) as Promise<User | null>
}
