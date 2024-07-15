import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
    fonts: {
        heading: `'IntelOneMono Bold', sans-serif`,
        body: `'IntelOneMono Medium', sans-serif`,
    },
    colors: {
        black: '#f8f8f2',
        backgroundColor: '#282a36',
    },
});

export default theme;
