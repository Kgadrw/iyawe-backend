import { ObjectId } from 'mongodb'
import { collections } from './db'

export type StationInfo = {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
}

export async function getStationForUserId(userId: ObjectId | string): Promise<StationInfo> {
  const id = typeof userId === 'string' ? new ObjectId(userId) : userId
  const institutionsCol = collections.institutions()
  const usersCol = collections.users()

  const institution = await institutionsCol.findOne({ userId: id })
  const userForInstitution = await usersCol.findOne({ _id: id })
  if (institution) {
    const displayName =
      (userForInstitution &&
        typeof userForInstitution.stationName === 'string' &&
        userForInstitution.stationName.trim()) ||
      institution.name ||
      'Collection station'
    return {
      name: displayName,
      address: institution.address || institution.location || null,
      phone: institution.phone || null,
      email: institution.email || null,
    }
  }

  const user = await usersCol.findOne({ _id: id })
  if (user) {
    const displayName =
      (typeof user.stationName === 'string' && user.stationName.trim()) || 'Collection station'
    return {
      name: displayName,
      address: null,
      phone: user.phone || null,
      email: user.email || null,
    }
  }

  return { name: 'Collection station' }
}
