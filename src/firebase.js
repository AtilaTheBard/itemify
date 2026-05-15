import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: "AIzaSyDOd-0iPeW61R5W4HKzJwMvOACU4LXwV0I",
  authDomain: "itemify-33599.firebaseapp.com",
  databaseURL: "https://itemify-33599-default-rtdb.firebaseio.com",
  projectId: "itemify-33599",
  storageBucket: "itemify-33599.firebasestorage.app",
  messagingSenderId: "1010785653055",
  appId: "1:1010785653055:web:0e793ad7538a963310438a"
}

const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)
