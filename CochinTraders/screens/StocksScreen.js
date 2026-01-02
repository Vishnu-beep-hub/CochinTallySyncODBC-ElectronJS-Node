import React, { useState, useEffect, useCallback } from 'react'
import { View, FlatList, RefreshControl } from 'react-native'
import { Card, Paragraph, Title, ActivityIndicator } from 'react-native-paper'
import axios from 'axios'
import { API_BASE } from '../App'

export default function StocksScreen({ company }) {
  const [stocks, setStocks] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchStocks = useCallback(async () => {
    if (!company) return
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/api/stocks/${encodeURIComponent(company)}`)
      if (res.data && res.data.data) setStocks(res.data.data)
    } catch (e) {
      console.warn('Failed to load stocks:', e.message)
    }
    setLoading(false)
  }, [company])

  useEffect(() => { fetchStocks() }, [company])

  if (!company) return null

  return (
    <View style={{ flex: 1, padding: 8 }}>
      {loading && <ActivityIndicator animating />}
      <FlatList
        data={stocks}
        keyExtractor={(item, i) => `${item.StockName || 'stock'}-${i}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchStocks} />}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: 8 }}>
            <Card.Content>
              <Title>{item.StockName}</Title>
              <Paragraph>Category: {item.Category || '-'}</Paragraph>
              <Paragraph>Qty: {item.ClosingQty ?? 0} {item.Unit || ''}</Paragraph>
              <Paragraph>Rate: {item.ClosingRate ?? 0} | Value: {item.ClosingValue ?? 0}</Paragraph>
            </Card.Content>
          </Card>
        )}
      />
    </View>
  )
}
