// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCK92tyG3feZXWJ0BnjQ_Y8ur4VNoiZO_Y",
  authDomain: "cochin-connect.firebaseapp.com",
  projectId: "cochin-connect",
  storageBucket: "cochin-connect.firebasestorage.app",
  messagingSenderId: "485422343851",
  appId: "1:485422343851:web:d614236155b73cb0d3f9ee",
  measurementId: "G-MYX716Z67R"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);