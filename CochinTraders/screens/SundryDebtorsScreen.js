import React, { useState, useEffect, useCallback } from 'react'
import { View, FlatList, RefreshControl } from 'react-native'
import { Card, Title, Paragraph, ActivityIndicator } from 'react-native-paper'
import axios from 'axios'
import { API_BASE } from '../App'

export default function SundryDebtorsScreen({ company }) {
  const [debtors, setDebtors] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchDebtors = useCallback(async () => {
    if (!company) return
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/api/parties/${encodeURIComponent(company)}`)
      const data = res.data && res.data.data ? res.data.data : []
      // Filter only Sundry Debtors
      const onlyDebtors = data.filter(p => (p.PrimaryGroup || p.PartyType || '').toLowerCase().includes('sundry debt'))
      setDebtors(onlyDebtors)
    } catch (e) {
      console.warn('Failed to load parties:', e.message)
    }
    setLoading(false)
  }, [company])

  useEffect(() => { fetchDebtors() }, [company])

  if (!company) return null

  return (
    <View style={{ flex: 1, padding: 8 }}>
      {loading && <ActivityIndicator animating />}
      <FlatList
        data={debtors}
        keyExtractor={(item, i) => `${item.PartyName || 'party'}-${i}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchDebtors} />}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: 8 }}>
            <Card.Content>
              <Title>{item.PartyName}</Title>
              <Paragraph>Group: {item.PrimaryGroup || item.PartyType || '-'}</Paragraph>
              <Paragraph>Balance: {item.Balance ?? item.ClosingBalance ?? 0}</Paragraph>
              <Paragraph>Contact: {item.ContactPerson || item.Phone || '-'}</Paragraph>
            </Card.Content>
          </Card>
        )}
      />
    </View>
  )
}
