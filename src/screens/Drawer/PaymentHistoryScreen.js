/**
 * PaymentHistoryScreen — container (Phase G batch 2, 2026-05-02)
 *
 * Owns: useTrade, useConfig, Firebase auth, axios invoice fetch,
 * PDF fetch/save/view/download via RNFS + FileViewer + Share.
 * Renders presentation resolved from `screens.PaymentHistoryScreen`.
 */

import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import axios from 'axios';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { decode as atob } from 'base-64';
import Toast from 'react-native-toast-message';
import { getAuth } from '@react-native-firebase/auth';
import Config from 'react-native-config';
import FileViewer from 'react-native-file-viewer';
import server from '../../utils/serverConfig';
import { generateToken } from '../../utils/SecurityTokenManager';
import { useTrade } from '../TradeContext';
import { useConfig } from '../../context/ConfigContext';
import { useComponent } from '../../design/useDesign';

const PaymentHistoryScreen = () => {
    const { configData } = useTrade();
    const config = useConfig();
    const gradient1 = config?.gradient1 || 'rgba(0, 86, 183, 1)';
    const gradient2 = config?.gradient2 || 'rgba(0, 38, 81, 1)';
    const navigation = useNavigation();
    const [InvoiceData, setInvoiceData] = useState([]);

    const auth = getAuth();
    const user = auth.currentUser;
    const userEmail = user?.email;

    const getInvoiceDetails = async () => {
        try {
            const response = await axios.get(
                `${server.ccxtServer.baseUrl}comms/get-invoices/${userEmail}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Advisor-Subdomain':
                            configData?.config?.REACT_APP_HEADER_NAME,
                        'aq-encrypted-key': generateToken(
                            Config.REACT_APP_AQ_KEYS,
                            Config.REACT_APP_AQ_SECRET,
                        ),
                    },
                },
            );
            const invoices = response.data.invoices || [];
            invoices.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
            });
            setInvoiceData(invoices);
        } catch (error) {
            console.error('Error fetching Invoice details:', error.response);
        }
    };

    useEffect(() => {
        if (userEmail) {
            getInvoiceDetails();
        }
    }, [userEmail]);

    const showToast = (message1, type, message2) => {
        Toast.show({
            type: type,
            text2: message2 + ' ' + message1,
            position: 'bottom',
            text1Style: {
                color: 'black',
                fontSize: 11,
                fontWeight: 0,
                fontFamily: 'Poppins-Medium',
            },
            text2Style: {
                color: 'black',
                fontSize: 12,
                fontFamily: 'Poppins-Regular',
            },
        });
    };

    const fetchInvoicePdf = async invoiceIndex => {
        try {
            const response = await axios.get(
                `${server.ccxtServer.baseUrl}comms/get-invoice-pdf/${userEmail}/${invoiceIndex}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Advisor-Subdomain':
                            configData?.config?.REACT_APP_HEADER_NAME,
                        'aq-encrypted-key': generateToken(
                            Config.REACT_APP_AQ_KEYS,
                            Config.REACT_APP_AQ_SECRET,
                        ),
                    },
                },
            );
            return response.data.pdf_bytes || null;
        } catch (error) {
            console.error('Error fetching invoice PDF:', error);
            return null;
        }
    };

    const savePdfToFile = async (pdfData, fileName) => {
        const path =
            Platform.OS === 'android'
                ? `${RNFS.DownloadDirectoryPath}/${fileName}`
                : `${RNFS.DocumentDirectoryPath}/${fileName}`;

        const binaryData = atob(pdfData);
        await RNFS.writeFile(path, binaryData, 'ascii');
        const fileExists = await RNFS.exists(path);
        if (!fileExists) {
            throw new Error('File not found after saving');
        }
        return path;
    };

    const handleViewInvoice = async (item, index) => {
        try {
            let pdfData = item.pdf_bytes;
            if (!pdfData) {
                pdfData = await fetchInvoicePdf(index);
            }
            if (!pdfData) {
                showToast('PDF data missing', 'error', '');
                return;
            }

            const fileName = `Invoice_${new Date().getTime()}.pdf`;
            const path = await savePdfToFile(pdfData, fileName);

            try {
                await FileViewer.open(path, { showOpenWithDialog: true });
            } catch (viewerError) {
                console.warn('Error opening file:', viewerError);
                if (Platform.OS === 'ios') {
                    await Share.open({
                        url: `file://${path}`,
                        type: 'application/pdf',
                        title: 'Open PDF',
                    });
                }
            }
        } catch (error) {
            console.error('Error viewing PDF:', error);
            showToast('Error opening invoice', 'error', '');
        }
    };

    const handleDownloadInvoice = async (item, index) => {
        try {
            let pdfData = item.pdf_bytes;
            if (!pdfData) {
                pdfData = await fetchInvoicePdf(index);
            }
            if (!pdfData) {
                showToast('PDF data missing', 'error', '');
                return;
            }

            const invoiceNumber =
                item.invoice_data?.invoice_number || new Date().getTime();
            const fileName = `invoice_${invoiceNumber}.pdf`.replace(/\//g, '_');
            await savePdfToFile(pdfData, fileName);
            showToast('Invoice saved to Downloads', 'success', '');
        } catch (error) {
            console.error('Error downloading PDF:', error);
            showToast('Error downloading invoice', 'error', '');
        }
    };

    const Presentation = useComponent('screens.PaymentHistoryScreen');

    return (
        <Presentation
            viewModel={{
                invoiceData: InvoiceData,
                gradient1,
                gradient2,
            }}
            actions={{
                onGoBack: () => navigation.goBack(),
                onDownloadInvoice: handleDownloadInvoice,
                onViewInvoice: handleViewInvoice,
            }}
        />
    );
};

export default PaymentHistoryScreen;
