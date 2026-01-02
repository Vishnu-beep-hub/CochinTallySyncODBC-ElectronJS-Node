import React, { useState, useEffect } from 'react'
import { SafeAreaView, View, StyleSheet } from 'react-native'
import { Provider as PaperProvider, Appbar, Text } from 'react-native-paper'
import axios from 'axios'
import StocksScreen from './screens/StocksScreen'
import SundryDebtorsScreen from './screens/SundryDebtorsScreen'
import CompanyPicker from './components/CompanyPicker'
import { BottomNavigation } from 'react-native-paper'

// Set your API base URL here. For Android emulator use 10.0.2.2
export const API_BASE = 'http://localhost:3000'

export default function App() {
  const [company, setCompany] = useState(null)
  const [index, setIndex] = useState(0)
  const [routes] = useState([
    { key: 'stocks', title: 'Stocks' },
    { key: 'debtors', title: 'Sundry Debtors' }
  ])

  const renderScene = ({ route }) => {
    switch (route.key) {
      case 'stocks':
        return <StocksScreen company={company} />
      case 'debtors':
        return <SundryDebtorsScreen company={company} />
      default:
        return null
    }
  }

  return (
    <PaperProvider>
      <SafeAreaView style={styles.container}>
        <Appbar.Header elevated>
          <Appbar.Content title="Cochin Traders" subtitle={company || 'Select company'} />
        </Appbar.Header>

        <View style={styles.pickerRow}>
          <CompanyPicker apiBase={API_BASE} value={company} onChange={setCompany} />
        </View>

        <View style={styles.content}>
          {company ? (
            <BottomNavigation
              navigationState={{ index, routes }}
              onIndexChange={setIndex}
              renderScene={renderScene}
            />
          ) : (
            <View style={styles.empty}><Text>Please select a company to load data.</Text></View>
          )}
        </View>
      </SafeAreaView>
    </PaperProvider>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pickerRow: { padding: 8, backgroundColor: '#f6f6f6' },
  content: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }
})
