#include <gtest/gtest.h>

template <typename T>
class TypedTestWithMapping : public testing::Test
{
};

class MyTypeMapping
{
public:
    template <typename T>
    static std::string GetName(int i)
    {
        return std::string("foo::bar::") + std::to_string(i);
    }
};

using MyTypes = ::testing::Types<char, int, unsigned int>;
TYPED_TEST_SUITE(TypedTestWithMapping, MyTypes, MyTypeMapping);

TYPED_TEST(TypedTestWithMapping, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST(TypedTestWithMapping, HasPropertyA)
{
    SUCCEED();
}
